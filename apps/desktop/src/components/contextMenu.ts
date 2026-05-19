import { inject, type InjectionKey } from "vue";

export interface ContextMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  action: () => void | Promise<void>;
}

export interface ContextMenuController {
  show: (event: MouseEvent, items: ContextMenuItem[]) => void;
  hide: () => void;
}

export const ContextMenuHostKey: InjectionKey<ContextMenuController> =
  Symbol("ContextMenuHost");

export function useContextMenu(): ContextMenuController {
  const host = inject(ContextMenuHostKey, null);
  if (!host) {
    return { show: () => {}, hide: () => {} };
  }
  return host;
}

function isEditableTarget(
  el: EventTarget | null,
): el is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

function selectedText(): string {
  return (window.getSelection()?.toString() ?? "").trim();
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } finally { ta.remove(); }
  }
}

async function readClipboard(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}

export function buildEditableContextMenuItems(
  event: MouseEvent,
): ContextMenuItem[] {
  const target = event.target;
  if (!isEditableTarget(target)) return [];
  const el = target as HTMLInputElement | HTMLTextAreaElement;
  const hasSelection = "selectionStart" in el
    ? (el.selectionEnd ?? 0) > (el.selectionStart ?? 0)
    : selectedText().length > 0;
  const readonly = "readOnly" in el ? el.readOnly : false;
  const disabledEdit = "disabled" in el ? el.disabled : false;
  const canMutate = !readonly && !disabledEdit;

  return [
    {
      id: "cut", label: "剪切", disabled: !hasSelection || !canMutate,
      action: async () => {
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;
        const v = el.value;
        const t = v.slice(start, end);
        if (t) {
          await writeClipboard(t);
          el.value = v.slice(0, start) + v.slice(end);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      },
    },
    {
      id: "copy", label: "复制", disabled: !hasSelection,
      action: async () => {
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;
        const v = el.value;
        const t = v.slice(start, end) || selectedText();
        if (t) await writeClipboard(t);
      },
    },
    {
      id: "paste", label: "粘贴", disabled: !canMutate,
      action: async () => {
        const text = await readClipboard();
        if (!text) return;
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;
        const v = el.value;
        el.value = v.slice(0, start) + text + v.slice(end);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      },
    },
    {
      id: "all", label: "全选", disabled: false,
      action: () => { el.select?.(); },
    },
  ];
}
