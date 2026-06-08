import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("主窗口设置路由", () => {
  it("独立设置窗口入口已下线", () => {
    const desktopRoot = resolve(".");

    expect(existsSync(resolve(desktopRoot, "src/window/settingsWindow.ts"))).toBe(false);
    expect(existsSync(resolve(desktopRoot, "src/pages/SettingsShell.vue"))).toBe(false);
  });
});
