/** Shared D1 capacity-error detection for soft-fail research writes. */
export const D1_CAPACITY_WRITE_ERROR =
  /SQLITE_FULL|database or disk is full|max database size|Exceeded maximum DB size|storage limit|D1_ERROR.*full/i;

export function isD1CapacityError(error) {
  return D1_CAPACITY_WRITE_ERROR.test(String(error?.message || error || ""));
}
