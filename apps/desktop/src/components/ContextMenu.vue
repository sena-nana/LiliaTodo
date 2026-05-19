<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, provide, ref } from "vue";
import {
  ContextMenuHostKey,
  type ContextMenuController,
  type ContextMenuItem,
} from "./contextMenu";

const open = ref(false);
const x = ref(0);
const y = ref(0);
const items = ref<ContextMenuItem[]>([]);
const activeIndex = ref(0);
const menuRef = ref<HTMLElement | null>(null);

async function show(event: MouseEvent, next: ContextMenuItem[]) {
  event.preventDefault();
  if (next.length === 0) {
    open.value = false;
    return;
  }
  items.value = next;
  const firstEnabled = next.findIndex((i) => !i.disabled);
  activeIndex.value = firstEnabled >= 0 ? firstEnabled : 0;
  x.value = event.clientX;
  y.value = event.clientY;
  open.value = true;
  await nextTick();
  reposition();
  menuRef.value?.focus();
}

function hide() { open.value = false; }

const controller: ContextMenuController = { show, hide };
provide(ContextMenuHostKey, controller);

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

async function runItem(item: ContextMenuItem) {
  if (item.disabled) return;
  hide();
  try { await item.action(); } catch { /* swallow */ }
}

// 全局屏蔽浏览器默认右键菜单；具体内容由业务组件通过 useContextMenu().show 声明。
function suppressDefault(e: MouseEvent) { e.preventDefault(); }

function onKeydown(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === "Escape") { e.preventDefault(); hide(); return; }
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
  hide();
}

onMounted(() => {
  document.addEventListener("contextmenu", suppressDefault);
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("mousedown", onDocPointerDown, true);
  window.addEventListener("blur", hide);
  window.addEventListener("resize", hide);
  window.addEventListener("scroll", hide, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("contextmenu", suppressDefault);
  document.removeEventListener("keydown", onKeydown);
  document.removeEventListener("mousedown", onDocPointerDown, true);
  window.removeEventListener("blur", hide);
  window.removeEventListener("resize", hide);
  window.removeEventListener("scroll", hide, true);
});
</script>

<template>
  <slot />
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
