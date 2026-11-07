// Rank: options put in order by the person. The state is the list of values, first is first.

/**
 * The order to show: the state's values that are still options, in its order, then any options it
 * doesn't name, in their own order. A stale or partial state never hides an option.
 */
export function rankOrder<T>(options: T[], state: unknown, same: (a: unknown, b: unknown) => boolean): T[] {
  const picked: T[] = [];
  for (const v of Array.isArray(state) ? state : []) {
    const hit = options.find((o) => same(o, v) && !picked.includes(o));
    if (hit !== undefined) picked.push(hit);
  }
  return [...picked, ...options.filter((o) => !picked.includes(o))];
}

/** The list with the item at from moved to to (both clamped to the list). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (!list.length) return list;
  const f = Math.max(0, Math.min(list.length - 1, from));
  const t = Math.max(0, Math.min(list.length - 1, to));
  if (f === t) return list;
  const next = list.slice();
  const [item] = next.splice(f, 1);
  next.splice(t, 0, item);
  return next;
}
