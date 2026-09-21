import test from "node:test";
import assert from "node:assert/strict";
import { parseCollegeJobOptions } from "../functions/api/college.js";

test("college API passes sport and reference model into model validation", () => {
  const req = new Request(
    "https://example.com/api/college?job=model-train-validate&sport=cfb&championModelId=CFB-FBIS-v2&trigger=scheduled"
  );
  const opts = parseCollegeJobOptions(req);
  assert.equal(opts.sport, "cfb");
  assert.equal(opts.championModelId, "CFB-FBIS-v2");
  assert.equal(opts.trigger, "scheduled");
});

test("referenceModelId alias maps to the legacy championModelId option", () => {
  const req = new Request(
    "https://example.com/api/college?job=model-train-validate&sport=cbb&referenceModelId=CBB-PINNACLE-IMPLIED"
  );
  const opts = parseCollegeJobOptions(req);
  assert.equal(opts.sport, "cbb");
  assert.equal(opts.championModelId, "CBB-PINNACLE-IMPLIED");
});

test("existing research job options remain intact", () => {
  const req = new Request(
    "https://example.com/api/college?job=cfbd-endpoint-audit&year=2026&week=8&modelId=CFB-CFBD-RATINGS-v1&operatorApproved=true&n=500&maeImproved=true&leakageOk=true&artifactOk=true&biasAbs=0.7"
  );
  const opts = parseCollegeJobOptions(req);
  assert.equal(opts.year, 2026);
  assert.equal(opts.week, 8);
  assert.equal(opts.modelId, "CFB-CFBD-RATINGS-v1");
  assert.equal(opts.operatorApproved, true);
  assert.equal(opts.n, 500);
  assert.equal(opts.maeImproved, true);
  assert.equal(opts.leakageOk, true);
  assert.equal(opts.artifactOk, true);
  assert.equal(opts.biasAbs, 0.7);
});
