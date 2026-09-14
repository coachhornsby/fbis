# Action/Apify Championship Checkpoint — 2026-09-12

Live production SHA: `417dc76e8c12cbd7131e77fe3b3aa8f1b4e3312b`  
Post-repair verify run: [34697253243](https://github.com/coachhornsby/fbis/actions/runs/34697253243)  
Migration: `0022_action_apify_harden` VERIFIED  

**Hard stops honored:** Action not in router · `decisionEligible=false` · `canQualify=false` · `canAuthorizeWager=false` · no bankroll dollars · no auto-execution · no FBIS UI rebuild in this phase.

---

## 1. Executive verdict

Matching repair is **PASS** on live production. Player-props outcomes normalizer is **PASS** for identity/price/line/book. Overall Action role recommendation: **CONTINUE_CHAMPIONSHIP** (shadow). Do **not** promote. Next major product phase after more synchronized windows: **COMPLETE FBIS UI/UX REBUILD** (not started).

## 2. Production SHA / deploy integrity

| Check | Result |
| --- | --- |
| `deploymentCommit` | `417dc76e8c12cbd7131e77fe3b3aa8f1b4e3312b` |
| Includes #81 outcomes[] normalizer | yes |
| Includes #82 secret-sync retries | yes |
| Migration | VERIFIED |
| Prior verify race on old SHA | mitigated by SHA wait gate |

## 3. Safety invariants (live)

| Gate | Live value |
| --- | --- |
| Mode | shadow |
| Plan env | **free** (owner still needs `ACTION_APIFY_PLAN=starter`) |
| `inProductionRouter` | false |
| `canQualify` | false |
| `canAuthorizeWager` | false |
| Odds order | `parlay → theodds → sharpapi → therundown` |

## 4. Matching repair — CFB

Fixture BASE run (3 Action games): **3/3 matched** (2 EXACT, 1 HIGH). Ambiguous 0, unmatched 0. Action→FBIS match rate **1.00** on returned set.

## 5. Matching repair — NFL

Fixture BASE run (4 Action games): **4/4 EXACT**. Ambiguous 0, unmatched 0. Action→FBIS match rate **1.00** on returned set.

## 6. Matching denominators (non-negotiable)

- Primary: Action→FBIS = matched / Action returned  
- Secondary: FBIS dated-slate coverage (small when `maxItems` ≪ slate; CFB 3/91, NFL 4/152 on this fixture run)  
- Never report secondary coverage as the match rate

## 7. Root causes fixed earlier (#80)

- CFB AMBIGUOUS: ESPN numeric IDs vs synthetic `ncaaf_*_b*` clones → canonical duplicate collapse  
- NFL UNMATCHED: Fri Chicago horizon missed Sunday slate → today→+3 Chicago days for football  
- Naming: Action full-name ↔ FBIS school via **namesMatchStrict fluff only** (not global MASCOT)

## 8. Player-props raw schema (truth)

Upstream market objects expose `outcomes[]` with `bookId`, `book`, `side`, `line`, `odds`, `playerId`, `playerName`, `isAlternate`, ticket/money %. No headshot/image fields — `imageUrl` stays nullable / not Action-sourced.

## 9. Player-props normalizer (#81)

Flattens `outcomes[]` into priced rows; maps `core_bet_type_*` aliases; stable contract; fail-closed decision flags.

## 10. Live PLAYER_PROPS — CFB (SHA-gated)

| Metric | Value |
| --- | --- |
| Games | 1 matched |
| Prop rows | 1428 |
| `stablePlayerIdRate` | **1.0** |
| `priceCoverage` | **1.0** |
| `lineCoverage` | **1.0** |
| `bookCoverage` | **1.0** |
| `sideCoverage` | **1.0** |
| `canonicalMarketRate` | **0.5469** |
| `imageUrlRate` | 0 |
| Est. cost | ~$0.079 |

## 11. Live PLAYER_PROPS — NFL (SHA-gated)

| Metric | Value |
| --- | --- |
| Games | 1 matched |
| Prop rows | 2986 |
| `stablePlayerIdRate` | **1.0** |
| `priceCoverage` | **1.0** |
| `lineCoverage` | **1.0** |
| `bookCoverage` | **1.0** |
| `sideCoverage` | **1.0** |
| `canonicalMarketRate` | **0.5392** |
| `imageUrlRate` | 0 |
| Est. cost | ~$0.079 |

## 12. PLAYER_PROPS readiness classification

**RESEARCH_READY** for CFB and NFL.

- Blocker to PRODUCTION_MARKET_READY: `MARKET_CANONICALIZATION` (overall canonical rate ~0.54 because milestones / research-only markets dilute the rate)  
- Model-relevant canonical markets **are** present: passing/rushing/receiving yards, completions, attempts, receptions  
- Still **not** decision-eligible

## 13. Model-relevant Action markets observed

`core_bet_type_9/10/12/15/16/18/30` (+ many milestones). Canonicalized: completions, passing_attempts, passing_yards, rushing_attempts, rushing_yards, receptions, receiving_yards.

## 14. Prop contract invariants

- Nullable image (not Action-sourced)  
- No invented player ids / prices  
- `decisionEligible=false` on normalized rows  
- Commercial-use review still required before customer-facing dependence

## 15. Verify spend (this SHA-gated run)

Plan estimate ~$0.335 / $0.50 cap. Actual ~$0.085+$0.092+$0.079+$0.079 ≈ **$0.335**.

## 16. Starter economics (code model)

Do not conflate:

| Component | Amount |
| --- | --- |
| Subscription | $19 |
| Prepaid platform usage | $19 |
| Gross platform usage | measured |
| Excess platform usage | max(0, gross − prepaid) |
| Invoice pre-tax | subscription + excess |

Production still reports `plan=free` until GitHub secret `ACTION_APIFY_PLAN=starter` is set and synced.

## 17. Cadence experiment profiles (shadow)

| Profile | Intent |
| --- | --- |
| A_LEAN | BASE-heavy |
| B_DECISION_INTEL | BASE + targeted MOVEMENT in decision window |
| C_MOVEMENT_HEAVY | Research sample only |

Recommendation while COLLECTING: prefer **B_DECISION_INTEL** for championship windows; sample C sparingly.

## 18. Collection architecture

Current volume does **not** require queues yet.

| Layer | Use |
| --- | --- |
| D1 | Latest matched events, prop index rows, scorecards, cost ledger |
| R2 (optional next) | Deep movement tick history / raw Actor payloads |
| Cron / workflow | Lifecycle snapshots (OPENING→POSTGAME), not minute polling |

## 19. Championship evidence status

State remains **COLLECTING**. Synchronized multi-window CFB/NFL/MLB scorecards are still thin. Matching + props plumbing is now trustworthy enough to accumulate evidence without burning spend on broken normalizers.

## 20. Independent fallback (non-negotiable)

Even if Action later wins a promotion design PR, keep an independent path:

```
parlay → theodds → sharpapi → therundown → fail closed
```

Action must not become a single point of failure.

## 21. Role recommendation (now)

**CONTINUE_CHAMPIONSHIP** / keep shadow.

| Role | Decision |
| --- | --- |
| PRIMARY market source | No |
| SECONDARY router candidate | Not yet |
| MARKET_INTELLIGENCE_ONLY | Plausible near-term after more windows |
| RESEARCH_ONLY props | Yes (RESEARCH_READY) |

## 22. What would be required before any promotion PR

- More synchronized OPENING→POSTGAME windows across CFB/NFL/MLB  
- Cost sufficiency under Starter with honest excess accounting  
- Reliability (success rate, schema drift) above promotion thresholds  
- Explicit owner approval  
- Separate PR — never sneak into repair/championship collection work  
- Commercial/terms review

## 23. Owner actions required

1. Set GitHub Actions / Pages secret `ACTION_APIFY_PLAN=starter` (and monthly budget if used) so health stops saying `free`  
2. Confirm rotated Apify token remains only in secret storage  
3. Approve bounded championship cadence spend under Starter prepaid usage  
4. Do **not** authorize router insertion yet

## 24. Explicit non-goals this phase

- No Action promotion  
- No odds-router / model / qualify / authorize / bankroll / execution changes  
- No FBIS UI/UX rebuild (deferred)

## 25. Next engineering sequence

1. Merge SHA-gate verify workflow (#83)  
2. Owner sets `ACTION_APIFY_PLAN=starter`  
3. Start bounded shadow cadence (CFB weekend + NFL week + MLB) writing shadow evidence only  
4. Publish rolling scorecard; revisit role recommendation  
5. After evidence plateau: **COMPLETE FBIS UI/UX REBUILD** as its own phase

## 26. UI/UX rebuild gate

UI rebuild is the **next major product phase after** championship evidence is in motion — not a substitute for market-data integrity work, and not started here.

## 27. Artifact index

| Artifact | Location |
| --- | --- |
| Live verify run | Actions `34697253243` |
| Downloaded bundle | `/opt/cursor/artifacts/action-post-repair-417dc76/` |
| Summary JSON | `/opt/cursor/artifacts/action-post-repair-417dc76/checkpoint-summary.json` |
| Prior race (invalid for props) | run `34696941754` on SHA `274ab55…` |

## 28. Residual risks

- `canonicalMarketRate` diluted by milestones → keep RESEARCH_READY until model-market-only rate is tracked separately or aliases expand  
- `timestampCoverage=0` on flattened outcomes — movement/time semantics need separate observation fields  
- Plan env mismatch (`free` vs paid Starter) can mis-gate budgets  
- Unofficial Actor / commercial-use risk unchanged  
- Championship scorecards still under-sampled for PRIMARY claims

## 29. One-line checkpoint

**Matching PASS · Props RESEARCH_READY on live `417dc76` · Action stays shadow · CONTINUE_CHAMPIONSHIP · UI rebuild next major phase after evidence cadence.**
