import { fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import ContextMenuHost from "../src/components/ContextMenuHost.vue";
import {
  buildEditableContextMenuItems,
  useContextMenu,
  type ContextMenuItem,
} from "../src/components/contextMenu";
import { installContextMenu } from "../src/composables/useContextMenu";
import { vContextMenu } from "../src/directives/contextMenu";

Object.defineProperty(navigator, "clipboard", {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(""),
  },
  configurable: true,
});

function renderMenuHost(template: string, setup: () => Record<string, unknown>) {
  const Wrapper = defineComponent({
    components: { ContextMenuHost },
    template: `${template}<ContextMenuHost />`,
    setup,
  });

  installContextMenu();

  return render(Wrapper, {
    global: {
      directives: {
        contextMenu: vContextMenu,
      },
    },
  });
}

describe("ContextMenu", () => {
  it("业务组件可以通过 show 打开菜单并执行动作", async () => {
    const action = vi.fn();
    const items: ContextMenuItem[] = [{ id: "open", label: "打开", action }];

    renderMenuHost(
      `<button data-testid="target" @contextmenu="openMenu">目标</button>`,
      () => {
        const contextMenu = useContextMenu();
        return {
          openMenu(event: MouseEvent) {
            contextMenu.show(event, items);
          },
        };
      },
    );

    await fireEvent.contextMenu(screen.getByTestId("target"));
    await fireEvent.click(await screen.findByRole("menuitem", { name: "打开" }));

    expect(action).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("声明式指令可以为元素提供右键菜单", async () => {
    const action = vi.fn();

    renderMenuHost(
      `<button data-testid="target" v-context-menu="items">目标</button>`,
      () => ({
        items: [{ id: "open", label: "打开", action }],
      }),
    );

    await fireEvent.contextMenu(screen.getByTestId("target"), {
      clientX: 96,
      clientY: 128,
    });

    expect(await screen.findByRole("menu")).toHaveStyle({
      left: "96px",
      top: "128px",
    });
    await fireEvent.click(screen.getByRole("menuitem", { name: "打开" }));

    expect(action).toHaveBeenCalledTimes(1);
  });

  it("可编辑输入框菜单提供剪切、复制、粘贴和全选", () => {
    const input = document.createElement("input");
    input.value = "hello world";
    document.body.appendChild(input);
    input.setSelectionRange(0, 5);

    const event = new MouseEvent("contextmenu", { clientX: 0, clientY: 0 });
    Object.defineProperty(event, "target", { value: input });

    expect(buildEditableContextMenuItems(event).map((item) => item.label)).toEqual([
      "剪切",
      "复制",
      "粘贴",
      "全选",
    ]);

    input.remove();
  });
});
