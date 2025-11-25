#!/bin/bash
set -euo pipefail

# 対象の月と通貨（必要に応じて増減OK）
MONTHS="01 02 03 04 05 06 07 08 09 10"
FIATS="USD EUR GBP EGP AED TWD IDR"

OUT="fx_upsert_2025.sql"
: > "$OUT"
echo "BEGIN;" >> "$OUT"

# 月初/月末（macOSのBSD date / GNU date 両対応）
month_range() {
  ym="$1"                              # 例: 2025-01
  y="${ym%-*}"; m="${ym#*-}"           # y=2025, m=01
  from="${y}-${m}-01"
  to=""
  if command -v gdate >/dev/null 2>&1; then
    # GNU date
    to=$(gdate -u -d "$from +1 month -1 day" +%Y-%m-%d)
  else
    # BSD date (macOS)
    # まず from（YYYY-MM-01）を date に一度通してから +1月 -1日
    from_fmt=$(date -u -j -f "%Y-%m-%d" "$from" "+%Y-%m-%d")
    to=$(date -u -j -v+1m -v-1d -f "%Y-%m-%d" "$from_fmt" "+%Y-%m-%d")
  fi
  echo "$from" "$to"
}

# frankfurter: https://api.frankfurter.app/YYYY-MM-01..YYYY-MM-31?from=JPY&to=USD
# 返るのは 1 JPY あたりの CCY → 逆数で JPY/1CCY に変換して平均化
fetch_month_avg() {
  ym="$1"   # YYYY-MM
  ccy="$2"  # USD, EUR, ...

  set +e
  read from to <<EOF2
$(month_range "$ym")
EOF2
  set -e

  url="https://api.frankfurter.app/${from}..${to}?from=JPY&to=${ccy}"
  json="$(curl -fsSL "$url" 2>/dev/null || true)"
  if [ -z "$json" ]; then
    echo "-- WARN: http error for $ccy $ym" >> "$OUT"
    return
  fi

  # 1 JPY -> CCY の日次配列を取り出し、>0 の日だけ 1/x を取って平均
  avg="$(echo "$json" | jq -r --arg C "$ccy" '
    .rates
    | [ .[] | .[$C] // empty | select(. > 0) | (1.0 / .) ]
    | if length>0 then (add/length) else empty end
  ')"

  if [ -n "$avg" ]; then
    printf "/* %s %s avg(JPY/1%s)=%s (frankfurter) */\n" "$ym" "$ccy" "$ccy" "$avg" >> "$OUT"
    cat >> "$OUT" <<SQL
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('${ccy}', '${ym}-01', ${avg}, ${avg}, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
SQL
  else
    echo "-- WARN: no samples for $ccy $ym (frankfurter)" >> "$OUT"
  fi
}

# メインループ
for m in $MONTHS; do
  ym="2025-$m"
  for c in $FIATS; do
    fetch_month_avg "$ym" "$c"
    sleep 0.2
  done
done

echo "COMMIT;" >> "$OUT"
echo "generated: $OUT"
