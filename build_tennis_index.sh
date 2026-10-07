#!/usr/bin/env bash
# FBIS authoritative Tennis index builder: ATP Tour and Challenger are independent hard gates.
set -euo pipefail
cd "$(dirname "$0")"
DATA_DIR="data/tennis"
AUDIT_OUT="${TENNIS_SOURCE_AUDIT:-artifacts/tennis-source-audit.jsonl}"
MIN_SERVE="${TENNIS_MIN_SERVE_COVERAGE:-0.80}"
mkdir -p "$DATA_DIR" "$(dirname "$AUDIT_OUT")"
rm -f "$DATA_DIR"/*.csv "$AUDIT_OUT"
PRIMARY="https://raw.githubusercontent.com/AlexandraMoldovan03/ATP-Tennis-Match-Outcome-Prediction-Using-PySpark-and-Machine-Learning/main"
FALLBACK="https://raw.githubusercontent.com/michaelbruen/ATP_Tennis_Project/main"
ARCHIVE="https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main/atp"
EXTRA_TOUR_TEMPLATE="${TENNIS_TOUR_SOURCE_TEMPLATE:-}"
EXTRA_CHALL_TEMPLATE="${TENNIS_CHALLENGER_SOURCE_TEMPLATE:-}"
validate(){ node scripts/tennis-index-source-audit.mjs --file="$1" --class="$2" --year="$3" --minServe="$MIN_SERVE"; }
try_url(){
  local url="$1" out="$2" cls="$3" year="$4" source="$5" tmp="${2}.tmp" audit
  rm -f "$tmp"
  curl -fLsS "$url" -o "$tmp" || return 1
  if ! audit=$(validate "$tmp" "$cls" "$year"); then echo "$audit" >> "$AUDIT_OUT"; rm -f "$tmp"; return 1; fi
  mv "$tmp" "$out"
  node -e 'const x=JSON.parse(process.argv[1]);x.source=process.argv[2];x.url=process.argv[3];console.log(JSON.stringify(x))' "$audit" "$source" "$url" >> "$AUDIT_OUT"
  return 0
}
fill_year(){
  local cls="$1" year="$2" out="$3" extra=""
  local -a urls names
  if [[ "$cls" == "tour" ]]; then
    urls=("$PRIMARY/atp_matches_${year}.csv" "$FALLBACK/atp_matches_${year}.csv" "$ARCHIVE/atp_matches_${year}.csv"); names=("AlexandraMoldovan03" "michaelbruen" "Aneeshers-archive"); extra="$EXTRA_TOUR_TEMPLATE"
  else
    urls=("$PRIMARY/atp_matches_qual_chall_${year}.csv" "$FALLBACK/atp_matches_qual_chall_${year}.csv" "$ARCHIVE/atp_matches_qual_chall_${year}.csv"); names=("AlexandraMoldovan03" "michaelbruen" "Aneeshers-archive"); extra="$EXTRA_CHALL_TEMPLATE"
  fi
  if [[ -n "$extra" ]]; then urls+=("${extra//\{year\}/$year}"); names+=("configured-extra"); fi
  for i in "${!urls[@]}"; do if try_url "${urls[$i]}" "$out" "$cls" "$year" "${names[$i]}"; then echo "✓ $cls $year <- ${names[$i]}"; return 0; fi; done
  echo "✗ missing valid $cls coverage for $year" >&2; return 1
}
fail=0
for y in $(seq 2015 2026); do fill_year tour "$y" "$DATA_DIR/atp_matches_${y}.csv" || fail=1; done
for y in $(seq 2020 2026); do fill_year challenger "$y" "$DATA_DIR/atp_matches_qual_chall_${y}.csv" || fail=1; done
if [[ "$fail" -ne 0 ]]; then echo "Tennis historical coverage incomplete; refusing to build index. See $AUDIT_OUT" >&2; exit 2; fi
node tennis/tennisFeatureBuilder.js "$DATA_DIR" tennis/tennis_serve_index.json
echo "✓ index rebuilt; audit=$AUDIT_OUT"
