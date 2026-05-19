import { beforeEach, describe, expect, it, vi } from "vitest";
import { openSettingsWindow } from "../src/window/settingsWindow";
import { Window } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

vi.mock("@tauri-apps/api/window", () => ({
  Window: {
    getByLabel: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: vi.fn(),
}));

describe("设置窗口服务", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("展示并聚焦已存在的设置窗口", async () => {
    const existing = {
      show: vi.fn().mockResolvedValue(undefined),
      setFocus: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(Window.getByLabel).mockResolvedValue(existing as never);

    await expect(openSettingsWindow()).resolves.toBeUndefined();

    expect(Window.getByLabel).toHaveBeenCalledWith("settings");
    expect(existing.show).toHaveBeenCalledTimes(1);
    expect(existing.setFocus).toHaveBeenCalledTimes(1);
    expect(WebviewWindow).not.toHaveBeenCalled();
  });

  it("不存在设置窗口时创建设置窗口", async () => {
    vi.mocked(Window.getByLabel).mockResolvedValue(null);

    await expect(openSettingsWindow()).resolves.toBeUndefined();

    expect(WebviewWindow).toHaveBeenCalledWith(
      "settings",
      expect.objectContaining({
        url: "/settings-shell",
        title: "Momo 设置",
        decorations: false,
      }),
    );
  });
});
