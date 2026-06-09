import { render, screen } from "@testing-library/vue";
import { createMemoryHistory } from "vue-router";
import { describe, expect, it, vi } from "vitest";
import type { Component } from "vue";
import { TaskRepositoryKey } from "../src/data/TaskRepositoryContext";
import SecondaryPanel from "../src/layouts/SecondaryPanel.vue";
import Today from "../src/pages/Today.vue";
import Inbox from "../src/pages/Inbox.vue";
import Calendar from "../src/pages/Calendar.vue";
import SyncSettings from "../src/pages/settings/SyncSettings.vue";
import AboutSettings from "../src/pages/settings/AboutSettings.vue";
import { createLiliaTodoRouter } from "../src/router";
import { fakeTaskRepository } from "./taskFixtures";

vi.mock("@tauri-apps/api/app", () => ({
  getName: vi.fn().mockResolvedValue("LiliaTodo"),
  getVersion: vi.fn().mockResolvedValue("0.1.0"),
}));

describe("UI 精简", () => {
  it("侧边栏不再显示任务标题文本", async () => {
    const router = createLiliaTodoRouter(createMemoryHistory());
    await router.push("/today");
    await router.isReady();

    render(SecondaryPanel, {
      global: {
        plugins: [router],
        provide: {
          [TaskRepositoryKey as symbol]: fakeTaskRepository(),
        },
      },
    });

    expect(screen.queryByRole("heading", { name: "任务" })).toBeNull();
  });

  it("任务主页面不再显示页标题和副标题", async () => {
    renderWithRepository(Today);
    expect(await screen.findByText("今日到期")).toBeInTheDocument();

    expect(screen.queryByRole("heading", { level: 1, name: "今日" })).toBeNull();
    expect(screen.queryByText("今日任务 · 逾期提醒 · 完成回看")).toBeNull();
  });

  it("收件箱页面不再显示页标题和副标题", async () => {
    renderWithRepository(Inbox);
    expect(await screen.findByText("收件箱暂无任务。可在今日页添加任务并选择收件箱。")).toBeInTheDocument();

    expect(screen.queryByRole("heading", { level: 1, name: "收件箱" })).toBeNull();
    expect(screen.queryByText("未分类任务 · 无截止时间的本地队列")).toBeNull();
  });

  it("日历页面不再显示页标题和副标题", async () => {
    renderWithRepository(Calendar);
    expect(await screen.findByText("未来 7 天暂无已安排任务。")).toBeInTheDocument();

    expect(screen.queryByRole("heading", { level: 1, name: "日历" })).toBeNull();
    expect(screen.queryByText("未来 7 天")).toBeNull();
  });

  it("设置页面不再显示页标题和副标题", async () => {
    renderWithRepository(SyncSettings);
    expect(screen.getByText("WebDAV 同步（坚果云优先）")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "同步" })).toBeNull();
    expect(screen.queryByText("WebDAV 同步配置")).toBeNull();

    renderWithRepository(AboutSettings);
    expect(await screen.findByText("应用名称")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "关于" })).toBeNull();
    expect(screen.queryByText("应用信息")).toBeNull();
  });
});

function renderWithRepository(component: Component) {
  return render(component, {
    global: {
      provide: {
        [TaskRepositoryKey as symbol]: fakeTaskRepository(),
      },
    },
  });
}
