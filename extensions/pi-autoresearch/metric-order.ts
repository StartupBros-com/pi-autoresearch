/** Strict metric ordering shared by live experiment state and persisted summaries. */
export function isBetter(value: number, current: number, direction: "lower" | "higher"): boolean {
  return direction === "lower" ? value < current : value > current;
}
