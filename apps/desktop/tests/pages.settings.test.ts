import { fireEvent, screen, waitFor } from "@testing-library/vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { fakeSecretsStore, fakeWebdavController, invokeMock, renderAppAt, renderWithRepository, resetPageTestMocks } from "./pageTestUtils";
import { createMemoryHistory } from "vue-router";
import AgentSettings from "../src/pages/settings/AgentSettings.vue";
import SyncSettings from "../src/pages/settings/SyncSettings.vue";
import Settings from "../src/pages/Settings.vue";
import { AgentAutoTriggerKey } from "../src/agent/autoTriggers";
import { WebdavSecretsStoreKey, WebdavSyncControllerKey } from "../src/sync/settingsSyncContext";
import { normalizeSettingsTab } from "../src/config/appShell";
import { createLiliaTodoRouter } from "../src/router";
import { fakeTaskRepository as fakeRepository } from "./taskFixtures";

afterEach(resetPageTestMocks);

describe("pages.settings", () => {
  it("Agent 设置页可启停 runtime 并回显自动触发有效状态", async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    localStorage.removeItem("liliatodo.agentSettings");
    const disabledReason = "尚未配置 backend，Agent 已禁用。";
    let status = {
      lifecycle: "disabled",
      agent_id: "momo-agent",
      agent_phase: "stop",
      backend_configured: false,
      disabled_reason: disabledReason,
      buffered_event_count: 1,
    };
    let events = [{
      sequence: 1,
      kind: "lifecycle",
      name: "runtime.disabled",
      agent_id: "momo-agent",
      attributes: { reason: disabledReason },
      error: null,
    }];

    invokeMock.mockImplementation((command: string) => {
      if (command === "agent_runtime_get_status") {
        return Promise.resolve(status);
      }
      if (command === "agent_runtime_list_events") {
        return Promise.resolve({ events });
      }
      if (command === "agent_runtime_start") {
        status = {
          lifecycle: "running",
          agent_id: "momo-agent",
          agent_phase: "awake",
          backend_configured: true,
          disabled_reason: null,
          buffered_event_count: 2,
        };
        events = [...events, {
          sequence: 2,
          kind: "lifecycle",
          name: "runtime.start",
          agent_id: "momo-agent",
          attributes: {},
          error: null,
        }];
        return Promise.resolve(status);
      }
      if (command === "agent_runtime_stop") {
        status = {
          lifecycle: "disabled",
          agent_id: "momo-agent",
          agent_phase: "stop",
          backend_configured: false,
          disabled_reason: disabledReason,
          buffered_event_count: 3,
        };
        events = [...events, {
          sequence: 3,
          kind: "lifecycle",
          name: "runtime.stop",
          agent_id: "momo-agent",
          attributes: {},
          error: null,
        }];
        return Promise.resolve(status);
      }
      return Promise.reject(new Error(`未预期的 Tauri 命令：${command}`));
    });

    const agentAutoTrigger = {
      diagnostics: ref({
        lastError: "自动扫描失败：backend 暂不可用",
        lastRun: {
          trigger: "task.updated",
          summary: "任务更新",
          status: "failed",
          diagnostic: "自动扫描失败：backend 暂不可用",
          suggestionCount: 0,
          enqueuedCount: 0,
          ranAt: "2026-05-16T12:00:00.000Z",
        },
      }),
      lastError: "自动扫描失败：backend 暂不可用",
      runStartupChecks: vi.fn().mockResolvedValue(undefined),
      requestReminderDue: vi.fn(),
      stop: vi.fn(),
    };

    renderWithRepository(AgentSettings, fakeRepository(), {
      global: {
        provide: {
          [AgentAutoTriggerKey as symbol]: agentAutoTrigger,
        },
      },
    });

    expect(await screen.findByText("Runtime 控制")).toBeInTheDocument();
    expect(await screen.findByText(disabledReason)).toBeInTheDocument();
    expect(screen.getByText("已禁用")).toBeInTheDocument();
    expect(screen.getByText("等待 runtime 启动")).toBeInTheDocument();
    expect(screen.getByText("任务更新：自动扫描失败：backend 暂不可用")).toBeInTheDocument();
    expect(screen.getByText("自动扫描失败：backend 暂不可用")).toBeInTheDocument();
    expect(screen.getByText("#1 runtime.disabled")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "启动 runtime" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("agent_runtime_start"));
    await waitFor(() => expect(screen.getByText("运行中")).toBeInTheDocument());
    expect(screen.getByText("自动触发运行中")).toBeInTheDocument();
    await waitFor(() => expect(agentAutoTrigger.runStartupChecks).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("#2 runtime.start")).toBeInTheDocument());

    await fireEvent.click(screen.getByRole("button", { name: "停止 runtime" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("agent_runtime_stop"));
    await waitFor(() => expect(screen.getByText("已禁用")).toBeInTheDocument());
    expect(screen.getByText("等待 runtime 启动")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("#3 runtime.stop")).toBeInTheDocument());

    await fireEvent.click(screen.getByRole("checkbox"));

    expect(screen.getByText("已关闭")).toBeInTheDocument();
    await waitFor(() =>
      expect(localStorage.getItem("liliatodo.agentSettings")).toContain('"automaticTriggersEnabled":false'),
    );
  });


  it("WebDAV 立即同步成功后在卡片上展示同步结果摘要", async () => {
    const repository = fakeRepository();
    const controller = fakeWebdavController({
      kind: "enabled",
      result: {
        ok: true,
        report: {
          pushedOpsCount: 2,
          pushedTaskChangeCount: 1,
          pushedTaskListChangeCount: 1,
          markedSyncedCount: 2,
          markedTaskChangeSyncedCount: 1,
          markedTaskListChangeSyncedCount: 1,
          pulledOpsCount: 0,
          appliedTaskCount: 0,
          deletedTaskCount: 0,
          appliedTaskListCount: 0,
          deletedTaskListCount: 0,
          serverCursor: "cursor-after",
          message: "已上传 1 条本地任务变更，已上传 1 个本地清单变更",
        },
      },
    });
    const secretsStore = fakeSecretsStore({
      baseUrl: "https://dav.jianguoyun.com/dav",
      root: "/liliatodo",
      username: "demo",
      password: "secret",
      deviceId: "desk-1",
    });

    renderWithRepository(SyncSettings, repository, {
      global: {
        provide: {
          [WebdavSyncControllerKey as symbol]: controller,
          [WebdavSecretsStoreKey as symbol]: secretsStore,
        },
      },
    });

    const syncButton = await screen.findByRole("button", { name: /立即同步/ });
    await fireEvent.click(syncButton);

    await waitFor(() => expect(controller.runOnce).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText("已上传 1 条本地任务变更，已上传 1 个本地清单变更"),
    ).toBeInTheDocument();
  });


  it("WebDAV 立即同步失败后在卡片上展示错误", async () => {
    const repository = fakeRepository();
    const controller = fakeWebdavController({
      kind: "enabled",
      result: { ok: false, error: "WebDAV 401 Unauthorized" },
    });
    const secretsStore = fakeSecretsStore({
      baseUrl: "https://dav.jianguoyun.com/dav",
      root: "/liliatodo",
      username: "demo",
      password: "secret",
      deviceId: "desk-1",
    });

    renderWithRepository(SyncSettings, repository, {
      global: {
        provide: {
          [WebdavSyncControllerKey as symbol]: controller,
          [WebdavSecretsStoreKey as symbol]: secretsStore,
        },
      },
    });

    const syncButton = await screen.findByRole("button", { name: /立即同步/ });
    await fireEvent.click(syncButton);

    await waitFor(() => expect(controller.runOnce).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText("错误：WebDAV 401 Unauthorized"),
    ).toBeInTheDocument();
  });


  it("WebDAV 凭据表单保存时留空应用密码会沿用既有密码", async () => {
    const repository = fakeRepository();
    const controller = fakeWebdavController({ kind: "enabled" });
    const secretsStore = fakeSecretsStore({
      baseUrl: "https://dav.jianguoyun.com/dav",
      root: "/liliatodo",
      username: "demo",
      password: "secret",
      deviceId: "desk-1",
    });

    renderWithRepository(SyncSettings, repository, {
      global: {
        provide: {
          [WebdavSyncControllerKey as symbol]: controller,
          [WebdavSecretsStoreKey as symbol]: secretsStore,
        },
      },
    });

    await screen.findByDisplayValue("demo");
    await fireEvent.update(screen.getByLabelText("用户名"), "demo-updated");
    await fireEvent.click(screen.getByRole("button", { name: "保存凭据" }));

    await waitFor(() =>
      expect(secretsStore.save).toHaveBeenCalledWith({
        baseUrl: "https://dav.jianguoyun.com/dav",
        root: "/liliatodo",
        username: "demo-updated",
        password: "secret",
        deviceId: "desk-1",
      }),
    );
    expect(await screen.findByText("已保存到本机安全存储")).toBeInTheDocument();
  });


  it("WebDAV 首次保存缺少应用密码时提示错误且不写入凭据", async () => {
    const repository = fakeRepository();
    const secretsStore = fakeSecretsStore(null);

    renderWithRepository(SyncSettings, repository, {
      global: {
        provide: {
          [WebdavSecretsStoreKey as symbol]: secretsStore,
        },
      },
    });

    await screen.findByLabelText("用户名");
    await fireEvent.update(screen.getByLabelText("用户名"), "demo");
    await fireEvent.click(screen.getByRole("button", { name: "保存凭据" }));

    expect(
      await screen.findByText("错误：首次保存必须填写应用密码"),
    ).toBeInTheDocument();
    expect(secretsStore.save).not.toHaveBeenCalled();
  });


  it("默认设置页路由展示 WebDAV 凭据卡片而非旧本地模拟入口", async () => {
    const repository = fakeRepository();

    await renderAppAt("/settings", repository);

    expect(
      await screen.findByText("WebDAV 同步（坚果云优先）"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /本地同步模拟/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/远程同步配置/)).not.toBeInTheDocument();
  });


  it("设置页通过 WebDAV controller 订阅同步完成通知", async () => {
    const repository = fakeRepository();
    const controller = fakeWebdavController({ kind: "enabled" });
    const router = createLiliaTodoRouter(createMemoryHistory());
    await router.push("/settings?tab=sync");
    await router.isReady();

    renderWithRepository(Settings, repository, {
      global: {
        plugins: [router],
        provide: {
          [WebdavSyncControllerKey as symbol]: controller,
          [WebdavSecretsStoreKey as symbol]: fakeSecretsStore({
            baseUrl: "https://dav.jianguoyun.com/dav",
            root: "/liliatodo",
            username: "demo",
            password: "secret",
            deviceId: "desk-1",
          }),
        },
      },
    });

    expect(await screen.findByText("WebDAV 同步（坚果云优先）")).toBeInTheDocument();
    expect(controller.onRunCompleted).toHaveBeenCalledTimes(1);

    controller.emitRunCompleted({
      pushedOpsCount: 0,
      pushedTaskChangeCount: 0,
      pushedTaskListChangeCount: 0,
      markedSyncedCount: 0,
      markedTaskChangeSyncedCount: 0,
      markedTaskListChangeSyncedCount: 0,
      pulledOpsCount: 2,
      appliedTaskCount: 2,
      deletedTaskCount: 0,
      appliedTaskListCount: 0,
      deletedTaskListCount: 0,
      serverCursor: "cursor-after",
      message: "已拉取 2 条远端变更",
    });

    expect(await screen.findByText("已拉取 2 条远端变更")).toBeInTheDocument();
  });


  it("设置 tab 使用同步作为默认回退", () => {
    expect(normalizeSettingsTab("sync")).toBe("sync");
    expect(normalizeSettingsTab("appearance")).toBe("appearance");
    expect(normalizeSettingsTab("about")).toBe("about");
    expect(normalizeSettingsTab("missing")).toBe("sync");
  });


});
