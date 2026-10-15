import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { onRequestPost } from "../functions/api/tennis-portrait-cutout.js";

const playerId = "tennis:wta:326408";
// Minimal RIFF/WEBP header + padding (not a real decodeable image, but passes signature gate).
function fakeWebp(n = 800) {
  const bytes = Buffer.alloc(n, 0);
  Buffer.from("RIFF").copy(bytes, 0);
  bytes.writeUInt32LE(n - 8, 4);
  Buffer.from("WEBP").copy(bytes, 8);
  return bytes;
}

function envFor({ row, putOk = true } = {}) {
  const puts = [];
  const updates = [];
  return {
    puts,
    updates,
    HARVEST_SECRET: "x".repeat(32),
    ARCHIVE: {
      async put(key, bytes, meta) {
        if (!putOk) throw new Error("R2_PUT_FAILED");
        puts.push({ key, bytes, meta });
      },
    },
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (sql.includes("FROM tennis_player_portraits")) return row || null;
                return null;
              },
              async run() {
                updates.push({ sql, args });
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  };
}

function req(body, secret = "x".repeat(32)) {
  return new Request("https://fbis.example/api/tennis-portrait-cutout", {
    method: "POST",
    headers: { "content-type": "application/json", "x-harvest-secret": secret },
    body: JSON.stringify(body),
  });
}

test("cutout publish rejects unauthorized and unapproved portraits", async () => {
  const bytes = fakeWebp();
  const body = {
    playerId,
    imageSha256: createHash("sha256").update(bytes).digest("hex"),
    dataBase64: bytes.toString("base64"),
  };
  const denied = await onRequestPost({ request: req(body, "wrong"), env: envFor() });
  assert.equal(denied.status, 403);

  const pending = await onRequestPost({
    request: req(body),
    env: envFor({
      row: {
        fbis_player_id: playerId,
        asset_key: `tennis/portraits/${playerId}/commons-curated-20261015.jpg`,
        content_type: "image/jpeg",
        approval_status: "PENDING",
        public_display_allowed: 0,
        display_scope: "PRIVATE_ONLY",
      },
    }),
  });
  assert.equal(pending.status, 409);
});

test("cutout publish writes WebP to R2 and updates approved registry row", async () => {
  const bytes = fakeWebp(1200);
  const imageSha256 = createHash("sha256").update(bytes).digest("hex");
  const env = envFor({
    row: {
      fbis_player_id: playerId,
      asset_key: `tennis/portraits/${playerId}/commons-curated-20261015.jpg`,
      content_type: "image/jpeg",
      approval_status: "APPROVED",
      public_display_allowed: 1,
      display_scope: "PUBLIC_WEB",
    },
  });
  const res = await onRequestPost({
    request: req({ playerId, imageSha256, dataBase64: bytes.toString("base64") }),
    env,
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "CUTOUT_PUBLISHED");
  assert.equal(body.assetKey, `tennis/portraits/${playerId}/approved-cutout.webp`);
  assert.equal(body.contentType, "image/webp");
  assert.equal(body.canAuthorizeWager, false);
  assert.equal(env.puts.length, 1);
  assert.equal(env.puts[0].key, body.assetKey);
  assert.equal(env.puts[0].meta.httpMetadata.contentType, "image/webp");
  assert.equal(env.updates.length, 1);
  assert.match(env.updates[0].sql, /UPDATE tennis_player_portraits/);
  assert.equal(env.updates[0].args[0], body.assetKey);
});
