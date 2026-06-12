import { fireEvent, screen, waitFor, within } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import Calendar from "../src/pages/Calendar.vue";
import { fakeTaskRepository as fakeRepository, taskFixture as task } from "./taskFixtures";
import {
  drawerRole,
  expectDrawerHeading,
  renderWithRepository,
  resetPageTestMocks,
} from "./pageTestUtils";

afterEach(resetPageTestMocks);

describe("日历页面", () => {
  it("默认显示周视图并加载周一到周日范围", async () => {
    vi.setSystemTime(new Date("2026-06-12T10:00:00.000Z"));
    const repository = fakeRepository({
      agenda: [
        task({
          id: "week-task",
          title: "周视图任务",
          dueAt: "2026-06-12T02:30:00.000Z",
        }),
      ],
    });

    try {
      renderWithRepository(Calendar, repository);

      expect(await screen.findByRole("button", { name: "周" })).toHaveClass("is-active");
      expect(await screen.findByText("周视图任务")).toBeInTheDocument();
      await waitFor(() => expect(repository.listAgenda).toHaveBeenCalledTimes(1));
      const [start, end] = vi.mocked(repository.listAgenda).mock.calls[0] ?? [];
      expect(start?.getDay()).toBe(1);
      expect(start?.getHours()).toBe(0);
      expect(end?.getDay()).toBe(0);
      expect(end?.getHours()).toBe(23);
    } finally {
      vi.useRealTimers();
    }
  });

  it("可切换日周月视图并重新加载对应范围", async () => {
    vi.setSystemTime(new Date("2026-06-12T10:00:00.000Z"));
    const repository = fakeRepository();

    try {
      renderWithRepository(Calendar, repository);
      await screen.findByRole("button", { name: "周" });

      await fireEvent.click(screen.getByRole("button", { name: "日" }));
      await waitFor(() => expect(repository.listAgenda).toHaveBeenCalledTimes(2));
      const [dayStart, dayEnd] = vi.mocked(repository.listAgenda).mock.calls[1] ?? [];
      expect(dayStart?.getDate()).toBe(12);
      expect(dayEnd?.getDate()).toBe(12);

      await fireEvent.click(screen.getByRole("button", { name: "月" }));
      await waitFor(() => expect(repository.listAgenda).toHaveBeenCalledTimes(3));
      const [monthStart, monthEnd] = vi.mocked(repository.listAgenda).mock.calls[2] ?? [];
      expect(monthStart?.getDay()).toBe(1);
      expect(monthEnd && Math.round((monthEnd.getTime() - monthStart!.getTime()) / (24 * 60 * 60 * 1000))).toBe(42);
    } finally {
      vi.useRealTimers();
    }
  });

  it("上一段今天下一段会更新查询范围", async () => {
    vi.setSystemTime(new Date("2026-06-12T10:00:00.000Z"));
    const repository = fakeRepository();

    try {
      renderWithRepository(Calendar, repository);
      await screen.findByRole("button", { name: "周" });

      await fireEvent.click(screen.getByRole("button", { name: "下一段" }));
      await waitFor(() => expect(repository.listAgenda).toHaveBeenCalledTimes(2));
      const [nextStart] = vi.mocked(repository.listAgenda).mock.calls[1] ?? [];
      expect(nextStart?.getDate()).toBe(15);

      await fireEvent.click(screen.getByRole("button", { name: "上一段" }));
      await waitFor(() => expect(repository.listAgenda).toHaveBeenCalledTimes(3));
      const [previousStart] = vi.mocked(repository.listAgenda).mock.calls[2] ?? [];
      expect(previousStart?.getDate()).toBe(8);

      await fireEvent.click(screen.getByRole("button", { name: "今天" }));
      await waitFor(() => expect(repository.listAgenda).toHaveBeenCalledTimes(4));
      const [todayStart] = vi.mocked(repository.listAgenda).mock.calls[3] ?? [];
      expect(todayStart?.getDate()).toBe(8);
    } finally {
      vi.useRealTimers();
    }
  });

  it("同一天任务按时间和优先级稳定排序", async () => {
    const repository = fakeRepository({
      agenda: [
        task({ id: "late", title: "下午任务", dueAt: "2026-06-12T07:00:00.000Z" }),
        task({ id: "high", title: "高优先级任务", dueAt: "2026-06-12T01:00:00.000Z", priority: 2 }),
        task({ id: "low", title: "低优先级任务", dueAt: "2026-06-12T01:00:00.000Z", priority: 0 }),
      ],
    });

    renderWithRepository(Calendar, repository);

    const day = await screen.findByLabelText("2026-06-12 日程");
    const titles = within(day).getAllByText(/^(高优先级任务|低优先级任务|下午任务)$/).map((item) => item.textContent);
    expect(titles).toEqual(["高优先级任务", "低优先级任务", "下午任务"]);
  });

  it("拖拽到日期格会改期并刷新", async () => {
    const repository = fakeRepository({
      agenda: [
        task({
          id: "drag-task",
          title: "拖拽任务",
          dueAt: "2026-06-12T02:30:00.000Z",
        }),
      ],
    });

    renderWithRepository(Calendar, repository);

    const taskButton = await screen.findByRole("button", { name: /拖拽任务/ });
    const targetDay = await screen.findByLabelText("2026-06-13 日程");
    await fireEvent.dragStart(taskButton);
    await fireEvent.drop(targetDay);

    await waitFor(() =>
      expect(repository.updateTask).toHaveBeenCalledWith("drag-task", {
        dueAt: "2026-06-13T02:30:00.000Z",
      }),
    );
    expect(repository.listAgenda).toHaveBeenCalledTimes(2);
  });

  it("拖拽更新失败显示中文错误且不关闭详情抽屉", async () => {
    const repository = fakeRepository({
      agenda: [
        task({
          id: "error-task",
          title: "失败任务",
          dueAt: "2026-06-12T02:30:00.000Z",
        }),
      ],
    });
    vi.mocked(repository.updateTask).mockRejectedValueOnce(new Error("改期失败"));

    renderWithRepository(Calendar, repository);

    await fireEvent.click(await screen.findByText("失败任务"));
    expect(await screen.findByRole(drawerRole, { name: "任务详情" })).toBeInTheDocument();

    const sourceDay = await screen.findByLabelText("2026-06-12 日程");
    await fireEvent.dragStart(within(sourceDay).getByRole("button", { name: /失败任务/ }));
    await fireEvent.drop(await screen.findByLabelText("2026-06-13 日程"));

    expect(await screen.findByText("错误：改期失败")).toBeInTheDocument();
    expect(screen.getByRole(drawerRole, { name: "任务详情" })).toBeInTheDocument();
  });

  it("点击任务仍能打开详情抽屉并保存后刷新", async () => {
    const repository = fakeRepository({
      agenda: [
        task({
          id: "drawer-task",
          title: "抽屉任务",
          dueAt: "2026-06-12T02:30:00.000Z",
        }),
      ],
    });

    renderWithRepository(Calendar, repository);

    await fireEvent.click(await screen.findByText("抽屉任务"));
    const drawer = await screen.findByRole(drawerRole, { name: "任务详情" });
    expectDrawerHeading(drawer, "抽屉任务");

    await fireEvent.update(within(drawer).getByLabelText("任务名"), "抽屉任务已更新");
    await fireEvent.click(within(drawer).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(repository.updateTask).toHaveBeenCalledWith(
      "drawer-task",
      expect.objectContaining({ title: "抽屉任务已更新" }),
    ));
    await waitFor(() => expect(repository.listAgenda).toHaveBeenCalledTimes(2));
  });

  it("显示排期建议但等待用户点击后才写入任务", async () => {
    const repository = fakeRepository({
      agenda: [
        task({
          id: "schedule-task",
          title: "准备方案",
          dueAt: "2026-06-12T10:00:00.000Z",
          estimateMin: 90,
          priority: 2,
        }),
        task({
          id: "estimate-task",
          title: "补材料",
          startAt: "2026-06-12T09:00:00.000Z",
          estimateMin: null,
        }),
      ],
    });

    renderWithRepository(Calendar, repository);

    const suggestions = await screen.findByLabelText("排期建议");
    expect(within(suggestions).getByText("安排「准备方案」")).toBeInTheDocument();
    expect(within(suggestions).getByText("补充「补材料」估时")).toBeInTheDocument();
    expect(repository.updateTask).not.toHaveBeenCalled();
    expect(repository.createAgentPendingActionFromTool).not.toHaveBeenCalled();

    const applyButtons = within(suggestions).getAllByRole("button", { name: "应用建议" });
    await fireEvent.click(applyButtons[0]);

    await waitFor(() => expect(repository.updateTask).toHaveBeenCalledWith(
      "schedule-task",
      { startAt: "2026-06-12T08:30:00.000Z" },
    ));
    expect(repository.createAgentPendingActionFromTool).not.toHaveBeenCalled();
  });

  it("应用排期建议失败时显示错误并保留建议", async () => {
    const repository = fakeRepository({
      agenda: [
        task({
          id: "schedule-task",
          title: "准备方案",
          dueAt: "2026-06-12T10:00:00.000Z",
          estimateMin: 90,
          priority: 2,
        }),
      ],
    });
    vi.mocked(repository.updateTask).mockRejectedValueOnce(new Error("应用建议失败"));

    renderWithRepository(Calendar, repository);

    const suggestions = await screen.findByLabelText("排期建议");
    await fireEvent.click(within(suggestions).getByRole("button", { name: "应用建议" }));

    expect(await screen.findByText("错误：应用建议失败")).toBeInTheDocument();
    expect(screen.getByLabelText("排期建议")).toBeInTheDocument();
  });

  it("显示容量与负载分析摘要且不自动写入任务", async () => {
    const repository = fakeRepository({
      agenda: [
        task({
          id: "overdue",
          title: "逾期任务",
          dueAt: "2026-06-12T08:00:00.000Z",
          estimateMin: 240,
          resources: [{ id: "person-1", type: "person", label: "小李", amount: null, unit: null }],
        }),
        task({
          id: "unknown",
          title: "未知估时",
          startAt: "2026-06-12T10:00:00.000Z",
          estimateMin: null,
          resources: [{ id: "room-1", type: "space", label: "会议室", amount: null, unit: null }],
        }),
        task({
          id: "heavy",
          title: "长任务",
          startAt: "2026-06-12T13:00:00.000Z",
          estimateMin: 180,
          resources: [{ id: "person-2", type: "person", label: "小李", amount: null, unit: null }],
        }),
      ],
    });
    vi.setSystemTime(new Date("2026-06-12T09:00:00.000Z"));

    try {
      renderWithRepository(Calendar, repository);

      const load = await screen.findByLabelText("容量与负载");
      expect(within(load).getByText("7 小时 30 分钟")).toBeInTheDocument();
      expect(within(load).getByText("1 个任务按 30 分钟估算")).toBeInTheDocument();
      expect(within(load).getByText("2026-06-12")).toBeInTheDocument();
      expect(within(load).getByText("已过截止时间的活跃任务")).toBeInTheDocument();
      expect(within(load).getByText("小李 2、会议室 1")).toBeInTheDocument();
      expect(repository.updateTask).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("显示冲突检测结果且不自动写入任务", async () => {
    const repository = fakeRepository({
      agenda: [
        task({
          id: "first",
          title: "第一段",
          startAt: "2026-06-12T09:00:00.000Z",
          dueAt: "2026-06-12T10:00:00.000Z",
        }),
        task({
          id: "second",
          title: "第二段",
          startAt: "2026-06-12T09:30:00.000Z",
          dueAt: "2026-06-12T11:00:00.000Z",
        }),
        task({
          id: "late-reminder",
          title: "提醒过晚任务",
          dueAt: "2026-06-12T10:00:00.000Z",
          reminders: [{ id: "reminder-1", triggerAt: "2026-06-12T11:00:00.000Z", status: "pending", message: null }],
        }),
      ],
    });

    renderWithRepository(Calendar, repository);

    const conflicts = await screen.findByLabelText("冲突检测");
    expect(within(conflicts).getByText("任务时间重叠")).toBeInTheDocument();
    expect(within(conflicts).getByText("「第一段」与「第二段」时间段重叠。")).toBeInTheDocument();
    expect(within(conflicts).getByText("「提醒过晚任务」提醒过晚")).toBeInTheDocument();
    expect(repository.updateTask).not.toHaveBeenCalled();
  });
});
