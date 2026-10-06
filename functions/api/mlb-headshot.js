const MLB_HEADSHOT_BASE = "https://img.mlbstatic.com/mlb-photos/image/upload/w_256,q_auto:best/v1/people";

function validId(value) {
  const s = String(value || "").trim();
  return /^\d{1,10}$/.test(s) ? s : null;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const id = validId(url.searchParams.get("id"));
  if (!id) return new Response("invalid player id", { status: 400 });

  const source = `${MLB_HEADSHOT_BASE}/${id}/headshot/67/current`;
  try {
    const res = await fetch(source, {
      headers: { accept: "image/avif,image/webp,image/png,image/*" },
      cf: {
        cacheTtl: 86400,
        cacheEverything: true,
        image: {
          segment: "foreground",
          width: 128,
          height: 160,
          fit: "contain",
          format: "webp",
          quality: 90,
          sharpen: 1,
          background: "rgba(0,0,0,0)",
        },
      },
    });

    if (!res.ok) {
      return new Response("headshot unavailable", {
        status: res.status,
        headers: { "cache-control": "public, max-age=300" },
      });
    }

    const headers = new Headers(res.headers);
    headers.set("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
    headers.set("access-control-allow-origin", "*");
    headers.set("x-fbis-headshot", "segmented-foreground-v1");
    return new Response(res.body, { status: 200, headers });
  } catch {
    return new Response("headshot unavailable", {
      status: 502,
      headers: { "cache-control": "public, max-age=300" },
    });
  }
}
