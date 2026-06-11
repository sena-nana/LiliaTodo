import { fireEvent, screen } from "@testing-library/vue";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithRepository, resetPageTestMocks } from "./pageTestUtils";
import Today from "../src/pages/Today.vue";
import { fakeTaskRepository as fakeRepository, taskFixture as task } from "./taskFixtures";

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


});
