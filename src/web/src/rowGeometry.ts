/** Cumulative offsets for mixed 36/56px rows (including the 4px row gap). */
export function rowOffsets(heights: number[]): number[] {
  const offsets = [0];
  for (const height of heights) offsets.push(offsets.at(-1)! + height);
  return offsets;
}
export function visibleRange(
  offsets: number[],
  top: number,
  height: number,
  overscan = 8,
): [number, number] {
  const locate = (position: number) => {
    let lo = 0,
      hi = offsets.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (offsets[mid] <= position) lo = mid;
      else hi = mid - 1;
    }
    return Math.min(lo, Math.max(0, offsets.length - 2));
  };
  return [
    Math.max(0, locate(top) - overscan),
    Math.min(offsets.length - 1, locate(top + height) + overscan + 1),
  ];
}
