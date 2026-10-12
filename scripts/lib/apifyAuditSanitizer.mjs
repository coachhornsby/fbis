// Uploadable audit artifacts intentionally exclude Actor inputs, credentials and action secrets.
const str = value => typeof value === "string" && value.trim() ? value : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
function base(page) {
  if (!page || !Array.isArray(page.items)) return { available: false, http: page?.http ?? null, total: null, items: [] };
  const total = count(page.total) ?? page.items.length;
  return { available: true, total, complete: page.items.length >= total, items: [] };
}
export function sanitizeSchedulePage(page) {
  const out = base(page);
  if (!out.available) return out;
  out.items = page.items.map(s => ({
    id: str(s.id), name: str(s.name), isEnabled: s.isEnabled === true,
    cronExpression: str(s.cronExpression), timeZone: str(s.timeZone ?? s.timezone),
    createdAt: str(s.createdAt), modifiedAt: str(s.modifiedAt),
    actions: Array.isArray(s.actions) ? s.actions.map(a => ({
      type: str(a.type), actorId: str(a.actorId), actorTaskId: str(a.actorTaskId),
    })) : [],
  }));
  return out;
}
export function sanitizeTaskPage(page) {
  const out = base(page);
  if (!out.available) return out;
  out.items = page.items.map(t => ({
    id: str(t.id), name: str(t.name), actorId: str(t.actId ?? t.actorId),
    createdAt: str(t.createdAt), modifiedAt: str(t.modifiedAt),
  }));
  return out;
}
