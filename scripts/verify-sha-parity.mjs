import { execSync } from "node:child_process";
import https from "node:https";

const canonical = process.argv[2] || "https://fbis-myz.pages.dev";
const alias = process.argv[3] || "https://cursor-cloud-agent-178792919.fbis-myz.pages.dev";

function gitSha(ref) {
  return execSync(`git rev-parse ${ref}`, { encoding: "utf8" }).trim();
}

function isFullSha(value) {
  return /^[a-f0-9]{40}$/i.test(String(value || ""));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 0, json: JSON.parse(body) });
          } catch (err) {
            reject(new Error(`Invalid JSON from ${url}: ${String(err?.message || err)}`));
          }
        });
      })
      .on("error", reject);
  });
}

async function main() {
  const localHead = gitSha("HEAD");
  const originMain = gitSha("origin/main");
  const canonicalHealth = await getJson(`${canonical.replace(/\/$/, "")}/api/health`);
  const aliasHealth = await getJson(`${alias.replace(/\/$/, "")}/api/health`);
  const canonicalSha = canonicalHealth.json?.deploymentCommit;
  const aliasSha = aliasHealth.json?.deploymentCommit;

  const report = {
    localHead,
    originMain,
    canonicalSha,
    aliasSha,
    canonicalHttp: canonicalHealth.status,
    aliasHttp: aliasHealth.status,
  };
  console.log(JSON.stringify(report, null, 2));

  const list = [localHead, originMain, canonicalSha, aliasSha];
  if (!list.every(isFullSha)) {
    throw new Error("One or more SHA values are not full 40-character hashes.");
  }
  if (!(localHead === originMain && originMain === canonicalSha && canonicalSha === aliasSha)) {
    throw new Error("SHA parity check failed: local/origin/canonical/alias do not match.");
  }
}

main().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
