import { harvestAll } from "../lib/projLedger.js";

export async function onSchedule(event) {
  const env = {
    PARLAY_API_KEY: event.env?.PARLAY_API_KEY,
    BALLPARK_PAL_API_KEY: event.env?.BALLPARK_PAL_API_KEY,
    caches: caches.default,
  };
  await harvestAll(3, env);
}
