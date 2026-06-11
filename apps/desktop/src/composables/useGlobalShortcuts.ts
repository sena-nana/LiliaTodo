import { onMounted, onUnmounted } from "vue";

interface ShortcutMap {
  [key: string]: () => void;
}

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return element.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useGlobalShortcuts(shortcuts: ShortcutMap) {
  function onKeydown(event: KeyboardEvent) {
    if (isEditableTarget(event.target)) return;
    const parts = [
      event.metaKey || event.ctrlKey ? "mod" : "",
      event.shiftKey ? "shift" : "",
      event.altKey ? "alt" : "",
      event.key.toLowerCase(),
    ].filter(Boolean);
    const key = parts.join("+");
    const handler = shortcuts[key];
    if (!handler) return;
    event.preventDefault();
    handler();
  }

  onMounted(() => window.addEventListener("keydown", onKeydown));
  onUnmounted(() => window.removeEventListener("keydown", onKeydown));
}
