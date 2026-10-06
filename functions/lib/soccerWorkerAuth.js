import { authorizeHarvest, unauthorizedBody } from "./auth.js";

export function authorizeSoccerWorker(request, env) {
  const token = String(env?.SOCCER_WORKER_TOKEN || "");
  const supplied = String(request?.headers?.get?.("x-soccer-worker-token") || "");
  if (token && supplied && supplied === token) return { ok: true, via: "cloudflare-soccer-worker" };
  return authorizeHarvest(request, env);
}

export { unauthorizedBody };
