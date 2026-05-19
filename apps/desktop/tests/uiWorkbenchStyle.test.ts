import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testsDir = dirname(fileURLToPath(import.meta.url));
const sourceDir = resolve(testsDir, "../src");

describe("表格式工作台视觉风格", () => {
  it("全局样式使用专业紧凑的工作台尺度", () => {
    const css = readFileSync(resolve(sourceDir, "styles.css"), "utf-8");

    expect(css).toContain("--accent-soft: #e8eefb;");
    expect(css).toContain("grid-template-columns: 48px 164px 1fr;");
    expect(css).toMatch(/\.shell\s*\{[^}]*background: var\(--bg-subtle\);/);
    expect(css).toMatch(/\.settings-shell\s*\{[^}]*background: var\(--bg-elev\);/);
    expect(css).toContain("border-bottom: 0;");
    expect(css).not.toContain(".secondary-panel::before");
    expect(css).not.toContain(".settings-shell__categories::before");
    expect(css).not.toMatch(/\.shell__main\s*\{[^}]*border-top-left-radius:/);
    expect(css).not.toMatch(/\.settings-shell__content\s*\{[^}]*border-top-left-radius:/);
    expect(css).toContain("border-radius: 8px;");
    expect(css).toContain("padding: 12px 14px;");
    expect(css).toContain("gap: 12px;");
    expect(css).toContain("padding: 7px 0;");
    expect(css).toContain("height: 32px;");
    expect(css).not.toMatch(/\.activity-bar\s*\{[^}]*border-top-right-radius:/);
    expect(css).not.toMatch(/\.secondary-panel\s*\{[^}]*border-top-left-radius:/);
    expect(css).not.toMatch(/\.settings-shell__categories\s*\{[^}]*border-top-right-radius:/);
    expect(css).toContain("overflow: hidden;");
  });

  it("WebDAV 设置表单控件与全局工作台风格保持一致", () => {
    const component = readFileSync(
      resolve(sourceDir, "components/WebdavSettingsCard.vue"),
      "utf-8",
    );

    expect(component).toContain("grid-template-columns: 88px 1fr;");
    expect(component).toContain("padding: 6px 10px;");
    expect(component).toContain("border: 1px solid var(--border);");
    expect(component).toContain("border-radius: 6px;");
    expect(component).toContain("background: var(--bg);");
  });
});
