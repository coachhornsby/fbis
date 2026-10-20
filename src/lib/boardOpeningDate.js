/**
 * On a fresh Board visit, select the current Chicago date rather than an old
 * ?date= from a bookmarked link or a previous browser session.
 *
 * Manual date navigation remains available while the Board is open.
 * Other routes retain their explicit URL dates.
 */
export function openingBoardDate({ route, urlDate, currentDate } = {}) {
  const today = String(currentDate || "");
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(today)) throw new Error("INVALID_CHICAGO_DATE");
  return route === "board" ? today : (iso.test(String(urlDate || "")) ? urlDate : today);
}
