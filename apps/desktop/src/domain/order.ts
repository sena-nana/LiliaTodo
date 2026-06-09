export type MoveDirection = -1 | 1;

export function compareByOrder<T extends { order: number; createdAt: string }>(a: T, b: T) {
  return a.order - b.order || a.createdAt.localeCompare(b.createdAt);
}

export function moveItem<T>(items: readonly T[], index: number, direction: MoveDirection) {
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= items.length) return null;
  const reordered = [...items];
  const [item] = reordered.splice(index, 1);
  reordered.splice(targetIndex, 0, item);
  return reordered;
}

export function moveItemById<T extends { id: string }>(
  items: readonly T[],
  id: string,
  direction: MoveDirection,
) {
  return moveItem(items, items.findIndex((item) => item.id === id), direction);
}
