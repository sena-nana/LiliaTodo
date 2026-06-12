import { fireEvent, screen, waitFor } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import DataSettings from "../src/pages/settings/DataSettings.vue";
import { renderWithRepository, resetPageTestMocks } from "./pageTestUtils";
import { fakeTaskRepository as fakeRepository, taskFixture as task } from "./taskFixtures";

afterEach(resetPageTestMocks);

describe("数据设置", () => {
  it("导出当前活跃任务并导入粘贴文本", async () => {
    const repository = fakeRepository({
      activeTasks: [
        task({ id: "task-1", title: "导出任务", estimateMin: 30, tags: ["备份"] }),
      ],
    });

    renderWithRepository(DataSettings, repository);

    await fireEvent.click(screen.getByRole("button", { name: "导出任务" }));

    expect(await screen.findByText("已导出 1 个任务。")).toBeInTheDocument();
    expect((screen.getByLabelText("导出文本") as HTMLTextAreaElement).value).toContain("导出任务");

    await fireEvent.update(screen.getByLabelText("导入导出格式"), "markdown");
    await fireEvent.update(screen.getByLabelText("导入文本"), "- [x] 导入任务");
    await fireEvent.click(screen.getByRole("button", { name: "导入任务" }));

    await waitFor(() =>
      expect(repository.createTask).toHaveBeenCalledWith(expect.objectContaining({
        title: "导入任务",
      })),
    );
    await waitFor(() => expect(repository.setStatus).toHaveBeenCalledWith(expect.any(String), "completed"));
    expect(await screen.findByText("已导入 1 个任务。")).toBeInTheDocument();
  });

  it("导入内容没有任务时显示错误且不写入仓库", async () => {
    const repository = fakeRepository();

    renderWithRepository(DataSettings, repository);

    await fireEvent.update(screen.getByLabelText("导入导出格式"), "markdown");
    await fireEvent.update(screen.getByLabelText("导入文本"), "普通说明文字");
    await fireEvent.click(screen.getByRole("button", { name: "导入任务" }));

    expect(await screen.findByText("错误：没有找到可导入的任务")).toBeInTheDocument();
    expect(repository.createTask).not.toHaveBeenCalled();
  });

  it("导入非法 JSON 时显示中文错误", async () => {
    const repository = fakeRepository();

    renderWithRepository(DataSettings, repository);

    await fireEvent.update(screen.getByLabelText("导入导出格式"), "json");
    await fireEvent.update(screen.getByLabelText("导入文本"), "{bad json");
    await fireEvent.click(screen.getByRole("button", { name: "导入任务" }));

    expect(await screen.findByText("错误：导入 JSON 格式不合法")).toBeInTheDocument();
    expect(repository.createTask).not.toHaveBeenCalled();
  });

  it("导入损坏 CSV 时显示中文错误", async () => {
    const repository = fakeRepository();

    renderWithRepository(DataSettings, repository);

    await fireEvent.update(screen.getByLabelText("导入导出格式"), "csv");
    await fireEvent.update(screen.getByLabelText("导入文本"), 'title,notes\n"损坏任务,备注');
    await fireEvent.click(screen.getByRole("button", { name: "导入任务" }));

    expect(await screen.findByText("错误：导入 CSV 格式不合法")).toBeInTheDocument();
    expect(repository.createTask).not.toHaveBeenCalled();
  });

  it("导入缺少 title 表头的 CSV 时显示中文错误", async () => {
    const repository = fakeRepository();

    renderWithRepository(DataSettings, repository);

    await fireEvent.update(screen.getByLabelText("导入导出格式"), "csv");
    await fireEvent.update(screen.getByLabelText("导入文本"), "name,notes\n错误表头,备注");
    await fireEvent.click(screen.getByRole("button", { name: "导入任务" }));

    expect(await screen.findByText("错误：导入 CSV 缺少 title 表头")).toBeInTheDocument();
    expect(repository.createTask).not.toHaveBeenCalled();
  });

  it("导入中途写入失败时提示已成功数量", async () => {
    const repository = fakeRepository();
    vi.mocked(repository.createTask)
      .mockResolvedValueOnce(task({ id: "created-1", title: "第一条" }))
      .mockRejectedValueOnce(new Error("数据库写入失败"));

    renderWithRepository(DataSettings, repository);

    await fireEvent.update(screen.getByLabelText("导入导出格式"), "markdown");
    await fireEvent.update(screen.getByLabelText("导入文本"), "- [ ] 第一条\n- [ ] 第二条");
    await fireEvent.click(screen.getByRole("button", { name: "导入任务" }));

    expect(await screen.findByText("错误：已导入 1 个任务，随后失败：数据库写入失败")).toBeInTheDocument();
    expect(repository.createTask).toHaveBeenCalledTimes(2);
  });

  it("导入已创建任务后设置状态失败时仍提示真实导入数量", async () => {
    const repository = fakeRepository();
    vi.mocked(repository.createTask).mockResolvedValueOnce(task({ id: "created-1", title: "已完成任务" }));
    vi.mocked(repository.setStatus).mockRejectedValueOnce(new Error("状态写入失败"));

    renderWithRepository(DataSettings, repository);

    await fireEvent.update(screen.getByLabelText("导入导出格式"), "markdown");
    await fireEvent.update(screen.getByLabelText("导入文本"), "- [x] 已完成任务");
    await fireEvent.click(screen.getByRole("button", { name: "导入任务" }));

    expect(await screen.findByText("错误：已导入 1 个任务，随后失败：状态写入失败")).toBeInTheDocument();
    expect(repository.createTask).toHaveBeenCalledTimes(1);
    expect(repository.setStatus).toHaveBeenCalledWith("created-1", "completed");
  });
});
