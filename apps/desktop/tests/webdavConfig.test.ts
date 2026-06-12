import { describe, expect, it } from "vitest";
import { buildWebdavRuntimeConfig } from "../src/sync/webdav/config";
import type { WebdavSecrets } from "../src/sync/webdav/secretsStore";

function secrets(overrides: Partial<WebdavSecrets> = {}): WebdavSecrets {
  return {
    baseUrl: "https://dav.jianguoyun.com/dav",
    root: "/liliatodo",
    username: "demo@example.com",
    password: "secret",
    deviceId: "desk-a",
    ...overrides,
  };
}

describe("buildWebdavRuntimeConfig", () => {
  it("把凭据转换为 WebDAV 客户端配置和布局", () => {
    const result = buildWebdavRuntimeConfig(secrets());

    expect(result.config).toEqual({
      baseUrl: "https://dav.jianguoyun.com/dav",
      root: "/liliatodo",
      credentials: {
        kind: "basic",
        username: "demo@example.com",
        password: "secret",
      },
    });
    expect(result.layout.root).toBe("/liliatodo");
  });

  it("root 为空时回落到默认同步根目录", () => {
    const result = buildWebdavRuntimeConfig(secrets({ root: "" }));

    expect(result.config.root).toBe("/liliatodo");
    expect(result.layout.root).toBe("/liliatodo");
  });

  it("root 带空格或缺少前导斜杠时规范化为绝对路径", () => {
    const result = buildWebdavRuntimeConfig(secrets({ root: "  todo-sync  " }));

    expect(result.config.root).toBe("/todo-sync");
    expect(result.layout.root).toBe("/todo-sync");
  });

  it("root 带尾随斜杠时配置和布局保持同一个规范化路径", () => {
    const result = buildWebdavRuntimeConfig(secrets({ root: " /todo-sync/ " }));

    expect(result.config.root).toBe("/todo-sync");
    expect(result.layout.root).toBe("/todo-sync");
  });
});
