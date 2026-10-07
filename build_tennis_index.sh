#!/usr/bin/env bash
# FBIS authoritative Tennis player-index builder.
# Fail-closed: Tour and Challenger coverage are validated independently by year.
set -euo pipefail
cd "$(dirname "$0")"

MODE="${TENNIS_BUILD_MODE:-production}"
START_YEAR="${TENNIS_START_YEAR:-2015}"
CHALL_START_YEAR="${TENNIS_CHALL_START_YEAR:-2020}"
END_YEAR="${TENNIS_END_YEAR:-$(date -u +%Y)}"
DATA_DIR="${TENNIS_DATA_DIR:-data/tennis}"
OUT="${TENNIS_INDEX_OUT:-tennis/tennis_serve_index.json}"
AUDIT_DIR="${TENNIS_AUDIT_DIR:-artifacts}"
AUDIT_JSONL="$AUDIT_DIR/tennis-source-audit.jsonl"
AUDIT_JSON="$AUDIT_DIR/tennis-source-audit.json"

mkdir -p "$DATA_DIR" "$AUDIT_DIR"
rm -f "$DATA_DIR"/atp_matches_*.csv "$AUDIT_JSONL" "$AUDIT_JSON"

# name|raw-base-url|authority
TOUR_SOURCES=(
  "alexandra|https://raw.githubusercontent.com/AlexandraMoldovan03/ATP-Tennis-Match-Outcome-Prediction-Using-PySpark-and-Machine-Learning/main|research_rights_pending"
  "michaelbruen|https://raw.githubusercontent.com/michaelbruen/ATP_Tennis_Project/main|research_rights_pending"
)
CHALL_SOURCES=(
  "alexandra|https://raw.githubusercontent.com/AlexandraMoldovan03/ATP-Tennis-Match-Outcome-Prediction-Using-PySpark-and-Machine-Learning/main|research_rights_pending"
  "michaelbruen|https://raw.githubusercontent.com/michaelbruen/ATP_Tennis_Project/main|research_rights_pending"
)

if [[ "$MODE" == "research" ]]; then
  if [[ "${TENNIS_RESEARCH_ALLOW_NONCOMMERCIAL:-0}" != "1" ]]; then
    echo "research mode requires TENNIS_RESEARCH_ALLOW_NONCOMMERCIAL=1" >&2
    exit 20
  fi
  # Archival Sackmann mirror, CC BY-NC-SA 4.0. Research only; never automatic production authority.
  CHALL_SOURCES+=("sackmann_archive|https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main/atp|cc_by_nc_sa_4_research_only")
fi

audit_one() {
  local file="$1" kind="$2" year="$3" source="$4" url="$5" authority="$6"
  local tmp rc report
  set +e
  report="$(node tennis/tennisSourceAudit.mjs --file "$file" --kind "$kind" --year "$year" 2>/dev/null)"
  rc=$?
  set -e
  if [[ -z "$report" ]]; then report='{"valid":false,"errors":["audit_no_output"]}'; fi
  node -e 'const r=JSON.parse(process.argv[1]);r.source=process.argv[2];r.url=process.argv[3];r.authority=process.argv[4];console.log(JSON.stringify(r))' "$report" "$source" "$url" "$authority" >> "$AUDIT_JSONL"
  return "$rc"
}

fetch_class_year() {
  local kind="$1" year="$2" filename="$3"; shift 3
  local sourceDef name base authority url tmp dest
  dest="$DATA_DIR/$filename"
  for sourceDef in "$@"; do
    IFS='|' read -r name base authority <<< "$sourceDef"
    url="$base/$filename"
    tmp="$dest.tmp"
    rm -f "$tmp"
    if ! curl -fLsS --max-time 90 -o "$tmp" "$url"; then
      printf '{"source":"%s","url":"%s","authority":"%s","file":"%s","kind":"%s","expectedYear":%s,"valid":false,"errors":["download_failed"]}\n'         "$name" "$url" "$authority" "$filename" "$kind" "$year" >> "$AUDIT_JSONL"
      continue
    fi
    if audit_one "$tmp" "$kind" "$year" "$name" "$url" "$authority"; then
      mv "$tmp" "$dest"
      echo "  $kind $year <- $name"
      return 0
    fi
    rm -f "$tmp"
  done
  echo "NO VALID $kind SOURCE FOR $year" >&2
  return 1
}

fail=0
echo "== ATP TOUR $START_YEAR-$END_YEAR =="
for y in $(seq "$START_YEAR" "$END_YEAR"); do
  fetch_class_year tour "$y" "atp_matches_$y.csv" "${TOUR_SOURCES[@]}" || fail=1
done

echo "== ATP CHALLENGER/QUALIFYING $CHALL_START_YEAR-$END_YEAR =="
for y in $(seq "$CHALL_START_YEAR" "$END_YEAR"); do
  fetch_class_year challenger "$y" "atp_matches_qual_chall_$y.csv" "${CHALL_SOURCES[@]}" || fail=1
done

node -e 'const fs=require("fs");const p=process.argv[1],o=process.argv[2];const rows=fs.existsSync(p)?fs.readFileSync(p,"utf8").trim().split(/\n+/).filter(Boolean).map(JSON.parse):[];fs.writeFileSync(o,JSON.stringify({generatedAt:new Date().toISOString(),mode:process.argv[3],rows},null,2));' "$AUDIT_JSONL" "$AUDIT_JSON" "$MODE"

if [[ "$fail" -ne 0 ]]; then
  echo "TENNIS SOURCE COVERAGE FAILED; see $AUDIT_JSON" >&2
  exit 21
fi

tour_expected=$((END_YEAR-START_YEAR+1))
chall_expected=$((END_YEAR-CHALL_START_YEAR+1))
tour_found=$(find "$DATA_DIR" -maxdepth 1 -name 'atp_matches_20*.csv' ! -name '*qual_chall*' | wc -l | tr -d ' ')
chall_found=$(find "$DATA_DIR" -maxdepth 1 -name 'atp_matches_qual_chall_20*.csv' | wc -l | tr -d ' ')
[[ "$tour_found" -eq "$tour_expected" ]] || { echo "tour coverage mismatch $tour_found/$tour_expected" >&2; exit 22; }
[[ "$chall_found" -eq "$chall_expected" ]] || { echo "challenger coverage mismatch $chall_found/$chall_expected" >&2; exit 23; }

node tennis/tennisFeatureBuilder.js "$DATA_DIR" "$OUT"
echo "Built $OUT"
echo "Audit: $AUDIT_JSON"
