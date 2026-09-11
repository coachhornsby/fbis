import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256Hex } from "../functions/lib/sha256Hex.js";
import { hashPayload } from "../functions/lib/actionApifyShadow.js";

describe("sha256Hex Workers-safe digest", () => {
  it("matches node:crypto for fingerprint inputs", () => {
    for (const s of ["", "abc", '{"a":1}', "x".repeat(2048), "parlay-credit-exhausted"]) {
      assert.equal(sha256Hex(s), createHash("sha256").update(s).digest("hex"));
    }
  });

  it("hashPayload stays stable without node:crypto", () => {
    const v = { homeTeam: "X", awayTeam: "Y", books: [{ name: "DK" }] };
    assert.equal(hashPayload(v), createHash("sha256").update(JSON.stringify(v)).digest("hex"));
  });
});
