/** Preserve official ESPN game time; never infer a countdown from tipoff. */
export function normalizeEspnDisplayClock(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  return /^\d{1,3}:[0-5]\d(?:\.\d)?$/.test(candidate) ? candidate : null;
}
