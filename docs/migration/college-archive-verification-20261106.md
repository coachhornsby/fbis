# FBIS college archive verification and GitHub shadow gates — Nov 6, 2026

## 1. Download and cryptographic integrity

The following existing owner-only Drive archives were retrieved and checked **byte-by-byte** in an isolated local readback. Each extracted member was compared against the **SHA-256 and byte count** recorded in its bundled archive manifest. No provider or Cloudflare calls were necessary.

| Drive archive | Drive ID | Archive SHA-256 | Internal files passed |
|---|---|---|---:|
| Torvik 2027 ratings/four factors | `1tJASpVptiIUlnTLFb3aTi8UrME1CCMWp` | `30b2fab621e47fff73084a3a51bf8c7f94b45c4fa4c0ceb9bfbe39df680285bb` | 4 / 4 |
| KenPom/CBBD authenticated 2027 | `1zMC-68JGjYO3-Xly02SXZrO7SbxfnVVB` | `fde1fb19484ac9821298f800d288f1fa036a4170e4732236e14c9ee8d339dbe4` | 19 / 19 |
| ESPN/Torvik current CBB 2027 | `1m3bPodgfT-ESQBstwKG4T8X6D0C5V8Jk` | `24189fbd54595e7f491c3f19daff6c354e4be3b1750e20a329bf7306301113fe` | 7 / 7 |

**CBB archive integrity: 30/30 internal files passed.** These archives are verified as complete copies of their recorded snapshots, **not fresh November 6 ratings**.

CFB: `CFB_Final_QA.json` was independently fetched from Drive and read successfully (source generated October 2). Its local SHA-256 is \`ce3e1626769a23968db971915d8e656f4dae94d9e4de7bb7cb53c6031e589a73\`, but no matching external file manifest was located in the checked repository. **CFB full archive SHA parity is not established.** Existing CFB SportsDataverse manifests identify hashes of separate historical source files; they do not prove this Drive file matches them.

## 2. The old 362 vs current 365 CBB programs

**Explained, not a previously unknown discovery.** Repository `data/teams/cbb-base.js` has 362 distinct IDs. `data/teams/cbb-supplement-2027.js` adds 3 distinct programs: Queens University (ESPN 2511), Southern Indiana (ESPN 88), and Lindenwood (ESPN 2815). Current `data/teams/cbb.js` exports both sets = 365.

The archived CBB ESPN teams and CBBD 2027 directory each contain **exactly the same 365 ESPN source IDs**, and the three supplements exist in both archives. The old base sorted ID fingerprint matches the 365 archive after removing these three (`db59ae3952d71cdf`, FNV-64 for a consistent set check). This is an exact registry explanation; the older 362-row **D1 migration table** was **not queried live** in this step and must not be marked repaired.

## 3. Source freshness is separate from integrity

- CBB authenticated CBBD/KenPom and Torvik archives: November 2. KenPom and Torvik sources include 365 teams. CBBD 2026–27 adjusted ratings returned zero rows as of November 2 and again in the November 6 audit. Prior-season 2025–26 adjusted ratings stay separate.
- CBB roster files contain 365 teams and 5,543 ESPN players; CBBD roster has 365 Division I teams and 5,541 players. Two ESPN-only players are explicitly recorded in the existing `roster-reconciliation.json` rather than deleted.
- CFB archive QA is October 2. The in-repo CFB SDV coverage snapshot is October 11 (446 games, 892 team-box rows, 38,665 player-stat rows). A bounded November 6 provider probe returned 138 FBS teams, 63 Week 10 games, and seven team-box games; Texas player-box query returned zero rows. These queries are not full season snapshots.
- November 6 schedule/final-score/player-box parity, point-in-time publication timestamps, and live CBB/CFB projection readiness **remain unverified**. Historical checksum success must not be used as a freshness gate.

## 4–5. GitHub frozen-model execution and shadow comparison

Workflow `fbis-college-model-shadow-regression.yml` runs the original unchanged CBB/CFB model test modules and the original model SHA checks in GitHub, with **no provider requests**. It checks code integrity, contract behavior, prior frozen CFB receipts, CBB 365-team composite identity, and existing historic CFB fixture acceptance receipts.

Existing CFB frozen production receipts contain stored score projections, but **do not include the complete time-aligned pregame feature snapshots for deterministic reruns**. Existing CBB readiness explicitly blocks production projection; there is no verified same-fixture original baseline paired with timestamp-aligned model inputs. Therefore **a real-game GitHub-vs-FBIS numerical shadow parity comparison cannot yet be claimed**. The workflow labels this as BLOCKED, not a pass.

## Gate to the next stage

Provide a secure, read-only route for the existing Drive archives to a GitHub job (no private provider files in this public repository), and a historical frozen A/A game-level baseline with the exact original point-in-time inputs. Then reuse the same model modules to run comparable predictions. No live promotion, model reweighting, wagering approval, paid collectors, D1 writes or Cloudflare calls in this phase.
