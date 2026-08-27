import { harvestAll, collectBoards } from "./lib/projLedger.js";

export async function onSchedule(event) {
  const env = {
    PARLAY_API_KEY: event.env?.PARLAY_API_KEY,
    BALLPARK_PAL_API_KEY: event.env?.BALLPARK_PAL_API_KEY,
    CFBD_API_KEY: event.env?.CFBD_API_KEY,
    caches: caches.default,
    DB: event.env?.DB,
  };
  await collectBoards(env, { odds: "cache" });
  await harvestAll(3, env);
}
