import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { describe, expect, it, vi } from "vitest";
import ContextMenu from "../src/components/ContextMenu.vue";

Object.defineProperty(navigator, "clipboard", {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(""),
  },
  configurable: true,
});

describe("ContextMenu", () => {
  it("input 上右键时阻止浏览器默认菜单", async () => {
    render(ContextMenu);
    const input = document.createElement("input");
    document.body.appendChild(input);

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100,
    });
    Object.defineProperty(event, "target", { value: input });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);

    input.remove();
  });

  it("输入框有选中区间时右键展示编辑菜单（剪切/复制/粘贴/全选）", async () => {
    render(ContextMenu);
    const input = document.createElement("input");
    input.value = "hello world";
    document.body.appendChild(input);
    input.setSelectionRange(0, 5);

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 50,
      clientY: 50,
    });
    Object.defineProperty(event, "target", { value: input });
    document.dispatchEvent(event);

    await waitFor(() => {
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    const menu = screen.getByRole("menu");
    expect(menu.textContent).toContain("剪切");
    expect(menu.textContent).toContain("复制");
    expect(menu.textContent).toContain("粘贴");
    expect(menu.textContent).toContain("全选");

    input.remove();
  });

  it("非输入区域无文本选中时不显示菜单", async () => {
    render(ContextMenu);

    // 确保没有文字被选中
    window.getSelection()?.removeAllRanges();

    const div = document.createElement("div");
    div.textContent = "plain text";
    document.body.appendChild(div);

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 200,
      clientY: 200,
    });
    Object.defineProperty(event, "target", { value: div });
    document.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 10));

    expect(screen.queryByRole("menu")).toBeNull();

    div.remove();
  });

  it("菜单打开后按 Esc 关闭", async () => {
    render(ContextMenu);
    const input = document.createElement("input");
    input.value = "hello";
    document.body.appendChild(input);
    input.setSelectionRange(0, 5);

    const contextEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 50,
      clientY: 50,
    });
    Object.defineProperty(contextEvent, "target", { value: input });
    document.dispatchEvent(contextEvent);

    await waitFor(() => {
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    await fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("menu")).toBeNull();
    });

    input.remove();
  });

  it("点击复制菜单项时调用 clipboard.writeText 并传入选中文本", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText, readText: vi.fn().mockResolvedValue("") },
      configurable: true,
    });

    render(ContextMenu);
    const input = document.createElement("input");
    input.value = "copy me";
    document.body.appendChild(input);
    input.setSelectionRange(0, 7);

    const contextEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 50,
      clientY: 50,
    });
    Object.defineProperty(contextEvent, "target", { value: input });
    document.dispatchEvent(contextEvent);

    await waitFor(() => {
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    const copyItem = screen.getByRole("menuitem", { name: "复制" });
    await fireEvent.click(copyItem);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("copy me");
      expect(writeText).toHaveBeenCalledTimes(1);
    });

    input.remove();
  });
});
