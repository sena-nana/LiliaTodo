import { describe, expect, it } from "vitest";
import {
  backend,
  BackendDisabledError,
  isBackendEnabled,
} from "../src/backend";
import {
  createCapabilities,
  noopCapabilities,
  type Capability,
} from "../src/backend/capabilities";
import { noopTransport } from "../src/backend/transport/noop";
import {
  disabledBackendConfig,
  isBackendConfigured,
} from "../src/backend/config";

describe("AB-01 backend 抽象层", () => {
  it("默认 backend 单例处于禁用状态", () => {
    expect(backend.config).toEqual(disabledBackendConfig);
    expect(isBackendEnabled()).toBe(false);
    expect(isBackendConfigured(backend.config)).toBe(false);
  });

  it("noopCapabilities 对所有能力返回 false", () => {
    const capabilities: Capability[] = [
      "sync",
      "tasks",
      "calendar",
      "gates",
      "sandbox",
      "mcp",
    ];
    for (const cap of capabilities) {
      expect(noopCapabilities.has(cap)).toBe(false);
      expect(noopCapabilities.version(cap)).toBeNull();
    }
  });

  it("createCapabilities 按显式表声明能力", () => {
    const caps = createCapabilities({ tasks: "1.0.0", sync: "1.2.0" });
    expect(caps.has("tasks")).toBe(true);
    expect(caps.version("tasks")).toBe("1.0.0");
    expect(caps.has("calendar")).toBe(false);
    expect(caps.version("sandbox")).toBeNull();
  });

  it("默认 backend 各命名空间方法均抛 BackendDisabledError", async () => {
    await expect(backend.sync.getEntity("task", "x")).rejects.toBeInstanceOf(
      BackendDisabledError,
    );
    await expect(backend.tasks.breakdown("t1")).rejects.toBeInstanceOf(
      BackendDisabledError,
    );
    await expect(backend.tasks.suggest("t1")).rejects.toBeInstanceOf(
      BackendDisabledError,
    );
    await expect(backend.calendar.planWeek()).rejects.toBeInstanceOf(
      BackendDisabledError,
    );
    await expect(backend.calendar.resolveConflict([])).rejects.toBeInstanceOf(
      BackendDisabledError,
    );
    await expect(backend.gates.list()).rejects.toBeInstanceOf(
      BackendDisabledError,
    );
    await expect(backend.sandbox.status("j1")).rejects.toBeInstanceOf(
      BackendDisabledError,
    );
    await expect(backend.mcp.listServers()).rejects.toBeInstanceOf(
      BackendDisabledError,
    );
  });

  it("noopTransport.request 抛 BackendDisabledError，close 可静默完成", async () => {
    await expect(noopTransport.request("foo", {})).rejects.toBeInstanceOf(
      BackendDisabledError,
    );
    expect(() => noopTransport.subscribe("topic", () => {})).toThrow(
      BackendDisabledError,
    );
    await expect(noopTransport.close()).resolves.toBeUndefined();
  });

  it("订阅类入口在 noop 形态下立刻抛错", () => {
    expect(() => backend.sync.onEntityChanged(() => {})).toThrow(
      BackendDisabledError,
    );
    expect(() => backend.gates.onPending(() => {})).toThrow(
      BackendDisabledError,
    );
    expect(() => backend.sandbox.tailLog("j1", () => {})).toThrow(
      BackendDisabledError,
    );
  });
});
