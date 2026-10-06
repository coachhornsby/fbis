# Tennis research-source authority audit

Status: research governance only. No source in this audit receives projection, qualification, or wager authority.

## Economic-use compatibility gate

FBIS Tennis is being built toward economically useful betting decisions. A dataset that is restricted to non-commercial use, or whose underlying data rights are unclear, must not be copied into the permanent FBIS data layer without separate permission or a compatible source contract.

| Source | Code/license | Underlying data | FBIS classification | Permanent ingestion |
|---|---|---|---|---|
| Jeff Sackmann ATP/WTA | CC BY-NC-SA 4.0 | Jeff Sackmann / Tennis Abstract datasets | RESEARCH / VALIDATION only | BLOCKED for economic-production use absent separate permission |
| Jeff Sackmann Match Charting Project | source-specific; audit separately | user-submitted point data | RESEARCH only pending rights audit | BLOCKED pending field-level rights/PIT audit |
| mcekovic Tennis Crystal Ball | Apache 2.0 code; prediction/Elo customizations CC BY-NC-SA 4.0 | primarily Sackmann-derived | RESEARCH methodology only | BLOCKED for restricted algorithms/data |
| VincentAuriau Tennis-Prediction | MIT code | Sackmann submodule/data | RESEARCH methodology only | CODE MAY BE STUDIED; DATA BLOCKED |
| gmalbert tennis-predictions | MIT code | mixed TennisMyLife / tennis-data.co.uk / API sources | RESEARCH methodology / source-discovery | BLOCKED until each underlying field/source contract is independently verified |
| Live Tennis API | audit required | provider API | UNSUITABLE until contract verified | BLOCKED pending commercial/redistribution/PIT terms |

## Jeff Sackmann decision

The first planned ingestion tranche cannot safely proceed into permanent FBIS storage under the current license. CC BY-NC-SA 4.0 explicitly restricts use to non-commercial purposes. Because FBIS Tennis is intended to support economically useful betting decisions, treat the source as research/validation-only unless separate permission is obtained.

Do not copy Sackmann rows into production D1/R2, do not use them to populate canonical Player Bank fields, and do not train or qualify production-authority models on them under the current rights state.

## Authority rules

Official ATP/WTA observations outrank research sources for official fields.

Research-source code may inform candidate feature definitions only when its software license permits that use. Underlying third-party data keeps its own license and does not inherit a repository's code license.

No research observation may be admitted through a name-only join.

No source receives projection influence merely because an adapter exists.

## Next admissible-source gate

Before bounded permanent ingestion, record:
- exact source owner and endpoint/repository;
- software license;
- underlying-data license/terms;
- commercial-use permission;
- redistribution/storage permission;
- attribution requirements;
- stable player and match identifiers;
- observation/effective timestamps;
- revision behavior;
- PIT suitability;
- field-level authority classification.

If any commercial-use or provenance term remains ambiguous, stop before permanent ingestion.


## 2026-10-06 rights update

### Sackmann
Permission request sent by FBIS owner on 2026-10-06. Status: PENDING. No authority change until the exact written response is reviewed and archived.

### Live Tennis API
Public product documentation explicitly markets historical data for backtesting and model training, and paid API terms license use of API responses within the subscriber's own applications/services. This makes it a materially stronger economic-use candidate than CC BY-NC-SA repository datasets.

Remaining blocker: Terms also prohibit scraping/caching/storing data beyond what is reasonably necessary to operate the application. FBIS requires persistent PIT history in D1/R2. Treat persistent long-horizon internal storage, derived-feature retention, and betting-decision support as RIGHTS_CONFIRMATION_REQUIRED until JSB Holdings confirms that this architecture is within the paid license.

Provider contact published for custom quotas/dedicated feeds: hello@livetennisapi.com.

Authority until confirmation:
- API observations: RESEARCH/VALIDATION candidate only.
- permanent D1/R2 corpus ingestion: BLOCKED.
- projection influence: 0.
- canQualify: false.
- wager authority: false.
