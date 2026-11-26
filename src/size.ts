/**
 * A size limit in MiB (1,048,576 bytes), the unit the limit really is in: 3,145,728 bytes is 3 MiB, not 3 MB (which is
 * 3,000,000). A whole number of MiB is written plain; anything else with one decimal, rounded down, because the
 * sentence it goes in says "larger than N": that stays true for every file that is refused.
 */
export function mib(bytes: number): string {
  const n = Math.floor((bytes / 1048576) * 10 + 1e-9) / 10;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
