import { fireEvent, screen } from "@testing-library/vue";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithRepository, resetPageTestMocks } from "./pageTestUtils";
import Today from "../src/pages/Today.vue";
import { fakeTaskRepository as fakeRepository, taskFixture as task } from "./taskFixtures";
import { createTaskTemplate, saveTaskTemplates } from "../src/domain/taskTemplates";

afterEach(resetPageTestMocks);

describe("pages.today", () => {
  it("显示今日分组并快速添加今日任务", async () => {
    const repository = fakeRepository({
      today: {
        overdue: [task({ id: "late", title: "Late invoice" })],
        dueToday: [task({ id: "focus", title: "Focus block" })],
        completedToday: [
          task({ id: "done", title: "Done review", status: "completed" }),
        ],
      },
    });

    renderWithRepository(Today, repository);

    expect(await screen.findByText("Late invoice")).toBeInTheDocument();
    expect(screen.getByText("Focus block")).toBeInTheDocument();
    expect(screen.getByText("Done review")).toBeInTheDocument();

    await fireEvent.update(screen.getByLabelText("快速添加任务"), "Write brief");
    await fireEvent.click(screen.getByRole("button", { name: "添加到今日" }));

    expect(repository.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Write brief",
        dueAt: expect.any(String),
      }),
    );
  });


  it("快速添加无截止日期任务到收件箱", async () => {
    const repository = fakeRepository();

    renderWithRepository(Today, repository);

    await screen.findByText("今日到期");
    await fireEvent.update(screen.getByLabelText("任务归属"), "inbox");
    await fireEvent.update(screen.getByLabelText("快速添加任务"), "Capture idea");
    await fireEvent.click(screen.getByRole("button", { name: "添加任务" }));

    expect(repository.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Capture idea",
        dueAt: null,
      }),
    );
  });


  it("快速添加带估时和明确截止时间的任务", async () => {
    const repository = fakeRepository();

    renderWithRepository(Today, repository);

    await screen.findByText("今日到期");
    await fireEvent.update(screen.getByLabelText("快速添加任务"), "Deep work");
    await fireEvent.update(screen.getByLabelText("任务截止时间"), "2026-05-18T09:30");
    await fireEvent.update(screen.getByLabelText("任务估时分钟"), "45");
    await fireEvent.click(screen.getByRole("button", { name: "添加到今日" }));

    expect(repository.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Deep work",
        dueAt: expect.any(String),
        estimateMin: 45,
      }),
    );
  });


  it("快速添加非法截止时间时显示中文错误且不创建任务", async () => {
    const repository = fakeRepository();

    renderWithRepository(Today, repository);

    await screen.findByText("今日到期");
    await fireEvent.update(screen.getByLabelText("快速添加任务"), "异常时间任务");
    const dueInput = screen.getByLabelText("任务截止时间") as HTMLInputElement;
    dueInput.setAttribute("type", "text");
    await fireEvent.update(dueInput, "bad-time");
    await fireEvent.click(screen.getByRole("button", { name: "添加到今日" }));

    expect(await screen.findByText("错误：任务截止时间不合法")).toBeInTheDocument();
    expect(repository.createTask).not.toHaveBeenCalled();
  });


  it("保存并套用任务模板创建任务", async () => {
    const repository = fakeRepository();
    window.localStorage.clear();

    renderWithRepository(Today, repository);

    await screen.findByText("今日到期");
    await fireEvent.update(screen.getByLabelText("快速添加任务"), "写周报");
    await fireEvent.update(screen.getByLabelText("任务估时分钟"), "45");
    await fireEvent.update(screen.getByLabelText("模板名称"), "周报模板");
    await fireEvent.update(screen.getByLabelText("模板标签"), "工作, 复盘");
    await fireEvent.update(screen.getByLabelText("模板检查项"), "收集数据|确认结论");
    await fireEvent.update(screen.getByLabelText("提醒提前分钟"), "30");
    await fireEvent.click(screen.getByRole("button", { name: "保存模板" }));

    expect(screen.getByRole("option", { name: "周报模板" })).toBeInTheDocument();
    expect(window.localStorage.getItem("liliatodo.taskTemplates.v1")).toContain("周报模板");

    await fireEvent.update(screen.getByLabelText("快速添加任务"), "临时任务");
    await fireEvent.update(screen.getByLabelText("任务估时分钟"), "");
    await fireEvent.update(screen.getByLabelText("任务模板"), screen.getByRole("option", { name: "周报模板" }).getAttribute("value") ?? "");
    await fireEvent.click(screen.getByRole("button", { name: "添加到今日" }));

    expect(repository.createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "写周报",
      estimateMin: 45,
      tags: ["工作", "复盘"],
      checklist: [
        expect.objectContaining({ title: "收集数据", order: 0 }),
        expect.objectContaining({ title: "确认结论", order: 1 }),
      ],
      reminders: [expect.objectContaining({ status: "pending" })],
      dueAt: expect.any(String),
    }));
  });


  it("模板名称为空时显示错误且不保存模板", async () => {
    const repository = fakeRepository();
    window.localStorage.clear();

    renderWithRepository(Today, repository);

    await screen.findByText("今日到期");
    await fireEvent.update(screen.getByLabelText("快速添加任务"), "写周报");
    await fireEvent.click(screen.getByRole("button", { name: "保存模板" }));

    expect(await screen.findByText("错误：模板名称不能为空")).toBeInTheDocument();
    expect(window.localStorage.getItem("liliatodo.taskTemplates.v1")).toBeNull();
  });


  it("套用带提醒偏移的模板会生成提醒", async () => {
    const repository = fakeRepository();
    const template = createTaskTemplate({
      name: "提醒模板",
      title: "准备会议",
      estimateMin: 30,
      reminderOffsetMin: 30,
    }, new Date("2026-06-12T00:00:00.000Z"));
    window.localStorage.clear();
    saveTaskTemplates(window.localStorage, [template]);

    renderWithRepository(Today, repository);

    await screen.findByText("今日到期");
    await fireEvent.update(screen.getByLabelText("任务截止时间"), "2026-06-12T10:00");
    await fireEvent.update(screen.getByLabelText("任务模板"), template.id);
    await fireEvent.click(screen.getByRole("button", { name: "添加到今日" }));

    expect(repository.createTask).toHaveBeenCalledWith(expect.objectContaining({
      title: "准备会议",
      reminders: [expect.objectContaining({
        triggerAt: "2026-06-12T01:30:00.000Z",
        status: "pending",
      })],
    }));
  });


});
