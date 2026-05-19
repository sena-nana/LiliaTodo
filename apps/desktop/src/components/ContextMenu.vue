<script setup lang="ts">
import { ref, nextTick, onMounted, onBeforeUnmount } from "vue";

type MenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  action: () => void | Promise<void>;
};

const open = ref(false);
const x = ref(0);
const y = ref(0);
const items = ref<MenuItem[]>([]);
const activeIndex = ref(0);
const menuRef = ref<HTMLElement | null>(null);

function isEditable(el: EventTarget | null): el is HTMLElement {
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

function buildItems(target: EventTarget | null): MenuItem[] {
  if (isEditable(target)) {
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
          const start = (el as HTMLInputElement).selectionStart ?? 0;
          const end = (el as HTMLInputElement).selectionEnd ?? 0;
          const v = (el as HTMLInputElement).value;
          const t = v.slice(start, end);
          if (t) {
            await writeClipboard(t);
            (el as HTMLInputElement).value = v.slice(0, start) + v.slice(end);
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }
        },
      },
      {
        id: "copy", label: "复制", disabled: !hasSelection,
        action: async () => {
          const start = (el as HTMLInputElement).selectionStart ?? 0;
          const end = (el as HTMLInputElement).selectionEnd ?? 0;
          const v = (el as HTMLInputElement).value;
          const t = v.slice(start, end) || selectedText();
          if (t) await writeClipboard(t);
        },
      },
      {
        id: "paste", label: "粘贴", disabled: !canMutate,
        action: async () => {
          const text = await readClipboard();
          if (!text) return;
          const start = (el as HTMLInputElement).selectionStart ?? 0;
          const end = (el as HTMLInputElement).selectionEnd ?? 0;
          const v = (el as HTMLInputElement).value;
          (el as HTMLInputElement).value = v.slice(0, start) + text + v.slice(end);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        },
      },
      {
        id: "all", label: "全选", disabled: false,
        action: () => { (el as HTMLInputElement).select?.(); },
      },
    ];
  }

  const sel = selectedText();
  if (sel.length > 0) {
    return [{ id: "copy", label: "复制", action: () => writeClipboard(sel) }];
  }
  return [];
}

async function openAt(event: MouseEvent) {
  event.preventDefault();
  const built = buildItems(event.target);
  if (built.length === 0) {
    open.value = false;
    return;
  }
  items.value = built;
  const firstEnabled = built.findIndex((i) => !i.disabled);
  activeIndex.value = firstEnabled >= 0 ? firstEnabled : 0;
  x.value = event.clientX;
  y.value = event.clientY;
  open.value = true;
  await nextTick();
  reposition();
  menuRef.value?.focus();
}

function reposition() {
  const el = menuRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const pad = 8;
  if (x.value + rect.width + pad > window.innerWidth) {
    x.value = Math.max(pad, window.innerWidth - rect.width - pad);
  }
  if (y.value + rect.height + pad > window.innerHeight) {
    y.value = Math.max(pad, window.innerHeight - rect.height - pad);
  }
}

function close() { open.value = false; }

async function runItem(item: MenuItem) {
  if (item.disabled) return;
  close();
  try { await item.action(); } catch { /* swallow */ }
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === "Escape") { e.preventDefault(); close(); return; }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    for (let i = 1; i <= items.value.length; i++) {
      const idx = (activeIndex.value + i) % items.value.length;
      if (!items.value[idx].disabled) { activeIndex.value = idx; break; }
    }
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    for (let i = 1; i <= items.value.length; i++) {
      const idx = (activeIndex.value - i + items.value.length) % items.value.length;
      if (!items.value[idx].disabled) { activeIndex.value = idx; break; }
    }
  } else if (e.key === "Enter") {
    e.preventDefault();
    const it = items.value[activeIndex.value];
    if (it) runItem(it);
  }
}

function onDocPointerDown(e: MouseEvent) {
  if (!open.value) return;
  if (e.button === 2) return;
  if (menuRef.value && e.target instanceof Node && menuRef.value.contains(e.target)) return;
  close();
}

onMounted(() => {
  document.addEventListener("contextmenu", openAt);
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("mousedown", onDocPointerDown, true);
  window.addEventListener("blur", close);
  window.addEventListener("resize", close);
  window.addEventListener("scroll", close, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("contextmenu", openAt);
  document.removeEventListener("keydown", onKeydown);
  document.removeEventListener("mousedown", onDocPointerDown, true);
  window.removeEventListener("blur", close);
  window.removeEventListener("resize", close);
  window.removeEventListener("scroll", close, true);
});
</script>

<template>
  <Teleport to="body">
    <ul
      v-if="open"
      ref="menuRef"
      class="context-menu"
      role="menu"
      tabindex="-1"
      :style="{ top: y + 'px', left: x + 'px' }"
    >
      <li
        v-for="(item, i) in items"
        :key="item.id"
        class="context-menu__item"
        :class="{ 'is-active': i === activeIndex, 'is-disabled': item.disabled }"
        role="menuitem"
        :aria-disabled="item.disabled || undefined"
        @mouseenter="activeIndex = i"
        @click="runItem(item)"
      >
        {{ item.label }}
      </li>
    </ul>
  </Teleport>
</template>
