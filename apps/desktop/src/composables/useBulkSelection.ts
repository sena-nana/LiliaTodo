import { computed, ref, type ComputedRef, type Ref } from "vue";

export interface BulkSelectionState {
  selectedIds: Ref<Set<string>>;
  selectedCount: ComputedRef<number>;
  toggle(id: string, checked: boolean): void;
  replace(ids: string[]): void;
  clear(): void;
  has(id: string): boolean;
}

export function useBulkSelection(): BulkSelectionState {
  const selectedIds = ref<Set<string>>(new Set());

  const selectedCount = computed(() => selectedIds.value.size);

  function toggle(id: string, checked: boolean) {
    const next = new Set(selectedIds.value);
    if (checked) next.add(id);
    else next.delete(id);
    selectedIds.value = next;
  }

  function replace(ids: string[]) {
    selectedIds.value = new Set(ids);
  }

  function clear() {
    selectedIds.value = new Set();
  }

  function has(id: string) {
    return selectedIds.value.has(id);
  }

  return {
    selectedIds,
    selectedCount,
    toggle,
    replace,
    clear,
    has,
  };
}
