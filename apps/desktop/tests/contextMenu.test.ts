import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import ContextMenu from "../src/components/ContextMenu.vue";
import {
  buildEditableContextMenuItems,
  useContextMenu,
  type ContextMenuItem,
} from "../src/components/contextMenu";

Object.defineProperty(navigator, "clipboard", {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(""),
  },
  configurable: true,
});

function mountHostWith(child: ReturnType<typeof defineComponent>) {
  return render(ContextMenu, { slots: { default: () => h(child) } });
}

describe("ContextMenu", () => {
  it("全局屏蔽浏览器默认右键菜单", async () => {
    render(ContextMenu);
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100,
    });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("未调用 show 时不展示菜单", async () => {
    render(ContextMenu);
    const div = document.createElement("div");
    document.body.appendChild(div);
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 50,
      clientY: 50,
    });
    Object.defineProperty(event, "target", { value: div });
    document.dispatchEvent(event);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByRole("menu")).toBeNull();
    div.remove();
  });

  it("业务组件调用 show 后按声明的 items 展示菜单", async () => {
    const action = vi.fn();
    const items: ContextMenuItem[] = [
      { id: "a", label: "动作一", action },
      { id: "b", label: "动作二", action: () => {} },
    ];
    const Child = defineComponent({
      setup() {
        const ctx = useContextMenu();
        return () =>
          h("button", {
            "data-testid": "trigger",
            onContextmenu: (e: MouseEvent) => ctx.show(e, items),
          });
      },
    });
    mountHostWith(Child);

    const trigger = screen.getByTestId("trigger");
    await fireEvent.contextMenu(trigger);

    const menu = await screen.findByRole("menu");
    expect(menu.textContent).toContain("动作一");
    expect(menu.textContent).toContain("动作二");

    await fireEvent.click(screen.getByRole("menuitem", { name: "动作一" }));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("buildEditableContextMenuItems 为输入框生成剪切/复制/粘贴/全选", () => {
    const input = document.createElement("input");
    input.value = "hello world";
    document.body.appendChild(input);
    input.setSelectionRange(0, 5);

    const event = new MouseEvent("contextmenu", { clientX: 0, clientY: 0 });
    Object.defineProperty(event, "target", { value: input });

    const items = buildEditableContextMenuItems(event);
    expect(items.map((i) => i.label)).toEqual(["剪切", "复制", "粘贴", "全选"]);
    expect(items.find((i) => i.id === "copy")?.disabled).toBe(false);
    expect(items.find((i) => i.id === "cut")?.disabled).toBe(false);

    input.remove();
  });

  it("buildEditableContextMenuItems 非可编辑元素返回空数组", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    const event = new MouseEvent("contextmenu", { clientX: 0, clientY: 0 });
    Object.defineProperty(event, "target", { value: div });
    expect(buildEditableContextMenuItems(event)).toEqual([]);
    div.remove();
  });

  it("菜单打开后按 Esc 关闭", async () => {
    const Child = defineComponent({
      setup() {
        const ctx = useContextMenu();
        return () =>
          h("button", {
            "data-testid": "trigger",
            onContextmenu: (e: MouseEvent) =>
              ctx.show(e, [{ id: "a", label: "动作", action: () => {} }]),
          });
      },
    });
    mountHostWith(Child);

    await fireEvent.contextMenu(screen.getByTestId("trigger"));
    await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument());

    await fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("点击复制菜单项时调用 clipboard.writeText 并传入选中文本", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText, readText: vi.fn().mockResolvedValue("") },
      configurable: true,
    });

    const Child = defineComponent({
      setup() {
        const ctx = useContextMenu();
        return () =>
          h("input", {
            "data-testid": "field",
            value: "copy me",
            onContextmenu: (e: MouseEvent) => {
              const el = e.target as HTMLInputElement;
              el.setSelectionRange(0, 7);
              ctx.show(e, buildEditableContextMenuItems(e));
            },
          });
      },
    });
    mountHostWith(Child);

    await fireEvent.contextMenu(screen.getByTestId("field"));
    await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument());

    await fireEvent.click(screen.getByRole("menuitem", { name: "复制" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("copy me");
      expect(writeText).toHaveBeenCalledTimes(1);
    });
  });
});
