/**
 * Diagnose invalid Pages/Cloudflare responses without ever exposing upstream bodies,
 * request headers, account access codes, signing keys, or account data.
 */
export async function readAccountApiResponse(response) {
  const status = Number.isInteger(response?.status) ? response.status : 0;
  const rawType = response?.headers?.get?.("content-type") || "";
  const contentType = rawType.toLowerCase();
  const isJson = /\bapplication\/(?:[\w.-]+\+)?json\b/.test(contentType);
  if (!isJson) {
    const responseKind = /html/.test(contentType) ? "HTML" : contentType ? "non-JSON" : "untyped";
    return {
      data: null,
      error: `FBIS account API returned HTTP ${status} (${responseKind}), not JSON. The Cloudflare edge or account function may be failing before it can respond.`,
    };
  }
  try {
    const data = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { data: null, error: `FBIS account API returned invalid JSON data (HTTP ${status}).` };
    }
    return { data, error: null };
  } catch {
    return { data: null, error: `FBIS account API returned unreadable JSON (HTTP ${status}).` };
  }
}
