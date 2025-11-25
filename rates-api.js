import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

if (process.env.DATABASE_URL) {
  let url = String(process.env.DATABASE_URL).trim();

  // postgresql:// → postgres:// に統一（正規表現を使わず安全に）
  const lower = url.toLowerCase();
  if (lower.startsWith('postgresql://')) {
    url = 'postgres://' + url.slice('postgresql://'.length);
  }

  // # と ! を URL エンコード（replaceAll は Node 14+ で可）
  if (url.includes('#') || url.includes('!')) {
    url = url.replaceAll('#', '%23').replaceAll('!', '%21');
  }

  process.env.DATABASE_URL = url;

  // マスクして表示（パスワードは出さない）
  try {
    const u = new URL(url);
    const masked = `${u.protocol}//${u.username}:${"*".repeat(8)}@${u.hostname}:${u.port}${u.pathname}${u.search || ""}`;
    console.log("DATABASE_URL normalized:", masked);
  } catch {
    console.log("DATABASE_URL normalized.");
  }
}

import cors from "cors";
import express from "express";
import pg from "pg";
import multer from "multer";
import { parse } from "csv-parse/sync";
import cron from "node-cron";
import fetch from "node-fetch";

const { Pool } = pg;
const { DATABASE_URL = "", PORT = 3001 } = process.env;

const BUILD_TAG = "manual-entry-debug-v2";

console.log("DEBUG DATABASE_URL =", DATABASE_URL);
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set");
  process.exit(1);
}

/**
 * 🔧 現在は SSM トンネル経由で RDS(assetdb) を利用しているため、
 *     RDS の pg_hba 設定に合わせて SSL 接続を必須にする。
 *     （ローカルの brew Postgres 5432 は使わない前提）
 */
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },  // ★ ここを true 相当（SSL）に戻す
  client_encoding: "UTF8",
  max: 50,
  min: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});

const app = express();
app.use(
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174"],
    methods: ["GET", "POST", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    optionsSuccessStatus: 204,
  })
);
app.options(/.*/, cors());
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const normalizeCode = (code) => {
  const s = (code || "").toString().trim().toUpperCase();
  if (!s) return null;
  if (["JPY", "YEN", "JPN"].includes(s)) return "JPY";
  if (["NT$", "NTD", "TWD"].includes(s)) return "TWD";
  if (["WBTC", "XBT"].includes(s)) return "BTC";
  return s;
};

const avg = (arr) => {
  if (!arr || arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
};

function monthRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return { start, end };
}

async function getCurrencyUniverse() {
  const client = await pool.connect();
  try {
    const fiat = new Set();
    const cryptoSet = new Set();
    const pegged = new Set();

    try {
      const { rows } = await client.query(`
        SELECT UPPER(code) AS code, LOWER(type) AS type, COALESCE(enabled,true) AS enabled
        FROM app.currency_master
      `);
      if (rows?.length) {
        for (const r of rows) {
          if (!r.enabled) continue;
          const c = normalizeCode(r.code);
          if (!c || c === "JPY") continue;
          if (r.type === "crypto") cryptoSet.add(c);
          else if (r.type === "pegged_usd") pegged.add(c);
          else fiat.add(c);
        }
      }
    } catch {
    }

    const { rows: used } = await client.query(`
      WITH raw AS (
        SELECT UPPER(TRIM(currency)) cur FROM app.manual_entry
        UNION ALL SELECT UPPER(TRIM(currency)) FROM app.fx_rate_monthly
        UNION ALL SELECT UPPER(TRIM(symbol))   FROM app.crypto_usd_monthly
      )
      SELECT DISTINCT cur FROM raw WHERE cur IS NOT NULL AND cur <> ''
    `);

    for (const r of used) {
      const c = normalizeCode(r.cur);
      if (!c || c === "JPY") continue;
      if (fiat.has(c) || cryptoSet.has(c) || pegged.has(c)) continue;
      if (["BTC", "ETH"].includes(c)) {
        cryptoSet.add(c);
      } else if (["USDT", "USDC"].includes(c)) {
        pegged.add(c);
      } else {
        fiat.add(c);
      }
    }

    return {
      fiat: Array.from(fiat).sort(),
      crypto: Array.from(cryptoSet).sort(),
      pegged_usd: Array.from(pegged).sort(),
    };
  } finally {
    client.release();
  }
}

app.get('/healthz', (req, res) => res.json({ ok: true, tag: BUILD_TAG }));
app.get('/api/dashboard/summary', async (req, res) => {
  const month = String(req.query.month || '').trim();
  const view  = String(req.query.view || 'total').trim();
  const mode  = String(req.query.mode || 'avg').trim();

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month (YYYY-MM) is required' });
  }

  const sql = `
  WITH
  curr_total AS (
    SELECT COALESCE(SUM(
             CASE WHEN m.flow_type='IN'  THEN m.jpy_amount
                  WHEN m.flow_type='OUT' THEN -m.jpy_amount END
           ),0) AS total
    FROM app.manual_entry m
    WHERE m.trade_date >= to_date($1,'YYYY-MM')
      AND m.trade_date <  (to_date($1,'YYYY-MM') + INTERVAL '1 month')
      AND m.segment IN (
        'corporate'::app.segment_type,
        'personal'::app.segment_type,
        'corporate_invest'::app.segment_type,
        'personal_invest'::app.segment_type
      )
      AND (COALESCE(m.category2_name,'') NOT LIKE '資金移動%')
      AND NOT (m.memo LIKE '%削除済み%')
  ),
  prev_total AS (
    SELECT COALESCE(SUM(
             CASE WHEN m.flow_type='IN'  THEN m.jpy_amount
                  WHEN m.flow_type='OUT' THEN -m.jpy_amount END
           ),0) AS total
    FROM app.manual_entry m
    WHERE m.trade_date >= (to_date($1,'YYYY-MM') - INTERVAL '1 month')
      AND m.trade_date <   to_date($1,'YYYY-MM')
      AND m.segment IN (
        'corporate'::app.segment_type,
        'personal'::app.segment_type,
        'corporate_invest'::app.segment_type,
        'personal_invest'::app.segment_type
      )
      AND (COALESCE(m.category2_name,'') NOT LIKE '資金移動%')
      AND NOT (m.memo LIKE '%削除済み%')
  ),
  curr_corp AS (
    SELECT COALESCE(SUM(
             CASE WHEN m.flow_type='IN'  THEN m.jpy_amount
                  WHEN m.flow_type='OUT' THEN -m.jpy_amount END
           ),0) AS total
    FROM app.manual_entry m
    WHERE m.trade_date >= to_date($1,'YYYY-MM')
      AND m.trade_date <  (to_date($1,'YYYY-MM') + INTERVAL '1 month')
      AND m.segment IN ('corporate'::app.segment_type,'corporate_invest'::app.segment_type)
      AND (COALESCE(m.category2_name,'') NOT LIKE '資金移動%')
      AND NOT (m.memo LIKE '%削除済み%')
  ),
  prev_corp AS (
    SELECT COALESCE(SUM(
             CASE WHEN m.flow_type='IN'  THEN m.jpy_amount
                  WHEN m.flow_type='OUT' THEN -m.jpy_amount END
           ),0) AS total
    FROM app.manual_entry m
    WHERE m.trade_date >= (to_date($1,'YYYY-MM') - INTERVAL '1 month')
      AND m.trade_date <   to_date($1,'YYYY-MM')
      AND m.segment IN ('corporate'::app.segment_type,'corporate_invest'::app.segment_type)
      AND (COALESCE(m.category2_name,'') NOT LIKE '資金移動%')
      AND NOT (m.memo LIKE '%削除済み%')
  ),
  curr_person AS (
    SELECT COALESCE(SUM(
             CASE WHEN m.flow_type='IN'  THEN m.jpy_amount
                  WHEN m.flow_type='OUT' THEN -m.jpy_amount END
           ),0) AS total
    FROM app.manual_entry m
    WHERE m.trade_date >= to_date($1,'YYYY-MM')
      AND m.trade_date <  (to_date($1,'YYYY-MM') + INTERVAL '1 month')
      AND m.segment IN ('personal'::app.segment_type,'personal_invest'::app.segment_type)
      AND (COALESCE(m.category2_name,'') NOT LIKE '資金移動%')
      AND NOT (m.memo LIKE '%削除済み%')
  ),
  prev_person AS (
    SELECT COALESCE(SUM(
             CASE WHEN m.flow_type='IN'  THEN m.jpy_amount
                  WHEN m.flow_type='OUT' THEN -m.jpy_amount END
           ),0) AS total
    FROM app.manual_entry m
    WHERE m.trade_date >= (to_date($1,'YYYY-MM') - INTERVAL '1 month')
      AND m.trade_date <   to_date($1,'YYYY-MM')
      AND m.segment IN ('personal'::app.segment_type,'personal_invest'::app.segment_type)
      AND (COALESCE(m.category2_name,'') NOT LIKE '資金移動%')
      AND NOT (m.memo LIKE '%削除済み%')
  )
  SELECT
    (SELECT total FROM curr_total)   AS now_total,
    (SELECT total FROM prev_total)   AS prev_total,
    (SELECT total FROM curr_corp)    AS now_corp,
    (SELECT total FROM prev_corp)    AS prev_corp,
    (SELECT total FROM curr_person)  AS now_person,
    (SELECT total FROM prev_person)  AS prev_person
`;

  try {
    const { rows } = await pool.query(sql, [month]);
    const r = rows[0] || {};
    return res.json({
      month,
      rate_mode: mode,
      by_view: {
        total:     { now: Number(r.now_total||0),  prev: Number(r.prev_total||0) },
        corporate: { now: Number(r.now_corp||0),   prev: Number(r.prev_corp||0) },
        personal:  { now: Number(r.now_person||0), prev: Number(r.prev_person||0) },
        unassigned:{ now: Number(r.now_total||0) - Number(r.now_corp||0) - Number(r.now_person||0),
                     prev: Number(r.prev_total||0) - Number(r.prev_corp||0) - Number(r.prev_person||0) }
      }
    });
  } catch (e) {
    console.error('[dashboard/summary] error', e);
    return res.status(500).json({ error: 'dashboard_summary_failed' });
  }
});
app.get('/api/dashboard/monthly', async (req, res) => {
  const year = String(req.query.year || '').trim();
  const view = String(req.query.view || 'total').trim();
  const mode = String(req.query.mode || 'avg').trim();

  if (!year || !/^\d{4}$/.test(year)) {
    return res.status(400).json({ error: 'year (YYYY) is required' });
  }

  const segFilterInner =
    view === 'corporate'
      ? " AND me.segment IN ('corporate'::app.segment_type,'corporate_invest'::app.segment_type) "
      : view === 'personal'
      ? " AND me.segment IN ('personal'::app.segment_type,'personal_invest'::app.segment_type) "
      : " AND me.segment IN ('corporate'::app.segment_type,'personal'::app.segment_type,'corporate_invest'::app.segment_type,'personal_invest'::app.segment_type) ";

  const sql = `
    WITH months AS (
      SELECT generate_series(
        to_date($1||'-01','YYYY-MM'),
        to_date($1||'-12','YYYY-MM'),
        interval '1 month'
      ) AS month_start
    )
    SELECT
      to_char(m.month_start,'YYYY-MM') AS month,
      COALESCE((
        SELECT SUM(
                 CASE
                   WHEN me.flow_type='IN'  THEN me.jpy_amount
                   WHEN me.flow_type='OUT' THEN -me.jpy_amount
                   ELSE 0
                 END
               )
          FROM app.manual_entry me
         WHERE me.trade_date >= m.month_start
           AND me.trade_date <  (m.month_start + INTERVAL '1 month')
           ${segFilterInner}
           AND (COALESCE(me.category2_name,'') NOT LIKE '資金移動%')
           AND NOT (me.memo LIKE '%削除済み%')
      ),0) AS total
    FROM months m
    ORDER BY month;
  `;

  const client = await pool.connect();
  try {
    const { rows } = await client.query(sql, [year]);
    const normalized = rows.map(r => {
      const val = Number(r.total);
      return {
        month: r.month,
        total: val,
        total_jpy: val,
        value: val,
        amount: val,
      };
    });
    return res.json(normalized);
  } catch (e) {
    console.error('[dashboard/monthly] error', e);
    return res.status(500).json({ error: 'dashboard_monthly_failed' });
  } finally {
    client.release();
  }
});

app.get('/api/rates/monthly', async (req, res) => {
  try {
    const year = String(req.query.year || new Date().getFullYear());
    const sql = `
  SELECT to_char(month_start, 'YYYY-MM') AS ym,
         UPPER(currency) AS currency,
         rate_month_avg
  FROM app.fx_rate_monthly
  WHERE EXTRACT(YEAR FROM month_start) = $1::int
  ORDER BY ym, currency
`;
    const { rows } = await pool.query(sql, [year]);

    const map = new Map();
    for (const r of rows) {
      const ym = String(r.ym);
      const cur = String(r.currency).toUpperCase();
      const rate = Number(r.avg_rate);
      if (!map.has(ym)) map.set(ym, { month: ym });
      map.get(ym)[cur] = rate;
    }

    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i+1).padStart(2,'0')}`);
    const data = months.map(ym => map.get(ym) || { month: ym });
    res.json(data);
  } catch (e) {
    console.error('[rates/monthly] error', e);
    res.status(500).json({ error: 'rates_monthly_failed' });
  }
});

app.get('/api/assets', async (req, res) => {
  const month = String(req.query.month || '').trim();
  const view  = String(req.query.view  || 'total').trim();
  const cur   = String(req.query.currency || 'JPY').trim();

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month (YYYY-MM) is required' });
  }

  const segFilter =
      view === 'corporate'
      ? " AND m.segment IN ('corporate'::app.segment_type,'corporate_invest'::app.segment_type) "
      : view === 'personal'
      ? " AND m.segment IN ('personal'::app.segment_type,'personal_invest'::app.segment_type) "
      : " AND m.segment IN ('corporate'::app.segment_type,'personal'::app.segment_type,'corporate_invest'::app.segment_type,'personal_invest'::app.segment_type) ";

  const sql = `
  WITH base AS (
    SELECT m.account_name,
           m.segment,
           m.flow_type,
           m.jpy_amount,
           m.trade_date
    FROM app.manual_entry m
    WHERE m.trade_date >= to_date($1,'YYYY-MM')
      AND m.trade_date <  (to_date($1,'YYYY-MM') + INTERVAL '1 month')
      ${segFilter}
      AND (COALESCE(m.category2_name,'') NOT LIKE '資金移動%')
  ),
  agg AS (
    SELECT account_name,
           -- segment は表示用（代表値）。同一口座で混在する場合は本来は最頻値が望ましいが、まずは最大件数の方を採用
           mode() within group (order by segment) AS segment,
           sum(CASE WHEN flow_type='IN'  THEN jpy_amount
                    WHEN flow_type='OUT' THEN -jpy_amount
                    ELSE 0 END) AS total_jpy,
           count(*) AS cnt,
           max(trade_date) AS last_date
    FROM base
    GROUP BY account_name
  )
  SELECT
    a.account_name,
    a.segment,
    a.total_jpy::numeric AS total_jpy,
    a.cnt,
    a.last_date::date AS last_date
  FROM agg a
  ORDER BY a.total_jpy DESC, a.account_name;
`;

  const client = await pool.connect();
  try {
    const { rows } = await client.query(sql, [month]);

    let usdJpy = 1;
    if (cur === 'USD') {
      const q = `
        SELECT rate_month_avg
          FROM app.fx_rate_monthly
         WHERE currency='USD'
           AND to_char(month_start,'YYYY-MM')=$1
         LIMIT 1`;
      const r2 = await client.query(q, [month]);
      usdJpy = Number(r2.rows?.[0]?.rate_month_avg ?? 1) || 1;
    }

    const mapped = rows.map(r => {
      const jpy = Number(r.total_jpy || 0);
      const display = (cur === 'USD') ? (jpy / usdJpy) : jpy;
      return {
        account_name: r.account_name,
        segment: r.segment,
        cnt: Number(r.cnt || 0),
        last_date: r.last_date,
        total_jpy: jpy,
        total_display: display
      };
    });

    return res.json({ month, view, currency: cur, rows: mapped });
  } catch (e) {
    console.error('[assets] error', e);
    return res.status(500).json({ error: 'assets_failed' });
  } finally {
    client.release();
  }
});

const upload = multer({ storage: multer.memoryStorage() });

app.post(
  "/api/csv-import",
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "file is required" });
      const text = req.file.buffer.toString("utf-8");
      const records = parse(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      const localPool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      });
      const client = await localPool.connect();

      // ★ トランザクション開始
      await client.query('BEGIN');
      console.log('=== CSV import transaction started ===');

      const pick = (obj, keys) => {
        for (const k of keys) {
          if (obj[k] !== undefined && obj[k] !== null) {
            const v = String(obj[k]).trim();
            if (v !== "") return v;
          }
        }
        return null;
      };

      const toNum = (v) => {
        if (v == null) return null;
        const s = String(v).normalize("NFKC").trim().replace(/[^\d.-]/g, "");
        return s && /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
      };

      console.log('=== CSV import start ===');
      console.log('Records count:', records.length);

      let i = 0;
for (const r of records) {
  i++;

  const tradeDate   = pick(r, ["trade_date","date","csvdate","日付"]) || null;
  const accountName = pick(r, ["account_name","account","口座・ウォレット名"]) || null;
  const flowType    = (pick(r, ["flow_type","type","タイプ"]) || "IN").toUpperCase();
  const categoryName  = pick(r, ["category_name","category","カテゴリ","カテゴリ1"]) || null;
  const category2Name = pick(r, ["category2","カテゴリ2"]) || null;
  const amountNum   = toNum(pick(r, ["amount","金額"]));
  const currencyCode = (pick(r, ["currency","curr","通貨","Currency"]) || "").toUpperCase() || null;
  const rateNum     = toNum(pick(r, ["rate","レート"]));
  const jpyAmountNum= toNum(pick(r, ["jpy_amount","円換算金額"]));  // ← ここがリクエストどおり
  const contentText = pick(r, ["content","内容"]) || null;
  const memoText    = pick(r, ["memo","メモ"])   || null;
  const segmentVal  = pick(r, ["segment","区分"])|| null;

  await client.query(
    `INSERT INTO staging.csv_import_raw
     (source_file,row_num,trade_date,account_name,flow_type,category_name,category2,amount,currency,rate,jpy_amount,content,memo,segment)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [req.file.originalname,i,tradeDate,accountName,flowType,categoryName,category2Name,amountNum,currencyCode,rateNum,jpyAmountNum,contentText,memoText,segmentVal]
  );
}

      console.log('=== CSV import completed ===');
      console.log('Total rows inserted:', i);

      // staging テーブルの件数を確認（トランザクション内）
      const checkResult = await client.query('SELECT COUNT(*) FROM staging.csv_import_raw');
      console.log('Staging table count in transaction:', checkResult.rows[0].count);

      // ★ トランザクションをコミット
      await client.query('COMMIT');
      console.log('=== Transaction committed ===');

      // コミット後の件数を確認
      const checkAfterCommit = await client.query('SELECT COUNT(*) FROM staging.csv_import_raw');
      console.log('Staging table count after commit:', checkAfterCommit.rows[0].count);

      res.json({ inserted: records.length });
      await client.release();
      await localPool.end();
    } catch (e) {
      console.error("csv_import_failed", e);
      console.error("Error stack:", e.stack);
      
      // ★ エラー時はロールバック
      try {
        await client.query('ROLLBACK');
        console.log('=== Transaction rolled back ===');
      } catch (rollbackError) {
        console.error('Rollback failed:', rollbackError);
      }
      
      res.status(500).json({ error: e.message });
    }
  }
);

app.post("/api/csv-import/commit", async (req, res) => {
  console.log("=== CSV Commit Start ==="); 
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("✓ Transaction started"); 
    
    // ステージングテーブルの件数を確認
    const countBefore = await client.query("SELECT COUNT(*) FROM staging.csv_import_raw");
    console.log("✓ Staging records BEFORE commit:", countBefore.rows[0].count);

    // WHERE句適用後の件数を確認
    const srcCount = await client.query(`
      SELECT COUNT(*) 
      FROM staging.csv_import_raw s
      WHERE btrim(replace(s.trade_date::text,' ','')) <> ''
        AND replace(s.trade_date::text,'/','-') ~ '^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}$'
    `);
    console.log("✓ Records after WHERE filter:", srcCount.rows[0].count);

    // サンプルデータを確認
    const sample = await client.query(`
      SELECT trade_date, account_name, category_name, category2, amount, currency, segment
      FROM staging.csv_import_raw
      LIMIT 3
    `);
    console.log("✓ Sample staging data:", JSON.stringify(sample.rows, null, 2));

    // 重複チェック用のハッシュを確認
    const hashSample = await client.query(`
      SELECT 
        md5(
          COALESCE(source_file,'') || ':' ||
          COALESCE(row_num::text,'') || ':' ||
          COALESCE(trade_date::text,'') || ':' ||
          COALESCE(account_name,'') || ':' ||
          COALESCE(flow_type,'') || ':' ||
          COALESCE(category_name,'') || ':' ||
          COALESCE(amount::text,'') || ':' ||
          COALESCE(currency,'') || ':' ||
          COALESCE(rate::text,'') || ':' ||
          COALESCE(jpy_amount::text,'') || ':' ||
          COALESCE(content,'') || ':' ||
          COALESCE(memo,'') || ':' ||
          COALESCE(segment,'')
        ) AS shash
      FROM staging.csv_import_raw
      LIMIT 3
    `);
    console.log("✓ Sample hashes:", JSON.stringify(hashSample.rows, null, 2));

    // 既存データと重複チェック
    const duplicateCheck = await client.query(`
      SELECT COUNT(*) 
      FROM staging.csv_import_raw s
      INNER JOIN app.manual_entry m ON m.source_hash = md5(
        COALESCE(s.source_file,'') || ':' ||
        COALESCE(s.row_num::text,'') || ':' ||
        COALESCE(s.trade_date::text,'') || ':' ||
        COALESCE(s.account_name,'') || ':' ||
        COALESCE(s.flow_type,'') || ':' ||
        COALESCE(s.category_name,'') || ':' ||
        COALESCE(s.amount::text,'') || ':' ||
        COALESCE(s.currency,'') || ':' ||
        COALESCE(s.rate::text,'') || ':' ||
        COALESCE(s.jpy_amount::text,'') || ':' ||
        COALESCE(s.content,'') || ':' ||
        COALESCE(s.memo,'') || ':' ||
        COALESCE(s.segment,'')
      )
    `);
    console.log("✓ Duplicate records found:", duplicateCheck.rows[0].count);

    // INSERT実行
    const result = await client.query(`
      WITH usd_rates AS (
        SELECT to_char(month_start,'YYYY-MM') AS ym, rate_month_avg
        FROM app.fx_rate_monthly
        WHERE currency='USD'
      ),
      crypto_rates AS (
        SELECT to_char(c.month_start,'YYYY-MM') AS ym, c.symbol, c.usd_month_avg * f.rate_month_avg AS jpy_rate
        FROM app.crypto_usd_monthly c
        JOIN app.fx_rate_monthly f
          ON f.currency='USD' AND f.month_start=c.month_start
      ),
      src AS (
        SELECT
          s.*,
          md5(
            COALESCE(s.source_file,'') || ':' ||
            COALESCE(s.row_num::text,'') || ':' ||
            COALESCE(s.trade_date::text,'') || ':' ||
            COALESCE(s.account_name,'') || ':' ||
            COALESCE(s.flow_type,'') || ':' ||
            COALESCE(s.category_name,'') || ':' ||
            COALESCE(s.amount::text,'') || ':' ||
            COALESCE(s.currency,'') || ':' ||
            COALESCE(s.rate::text,'') || ':' ||
            COALESCE(s.jpy_amount::text,'') || ':' ||
            COALESCE(s.content,'') || ':' ||
            COALESCE(s.memo,'') || ':' ||
            COALESCE(s.segment,'')
          ) AS shash
        FROM staging.csv_import_raw s
        WHERE
          btrim(replace(s.trade_date::text,' ','')) <> ''
          AND replace(s.trade_date::text,'/','-') ~ '^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}$'
      ),
      src_dedup AS (
        SELECT DISTINCT ON (shash) *
        FROM src
        ORDER BY shash, row_num
      )
      INSERT INTO app.manual_entry
  (trade_date, account_name, flow_type, category_id, category_name, category2_name,
   amount, currency, rate, jpy_amount, content, memo, source, source_hash, segment)
SELECT
  to_date(replace(sd.trade_date::text,'/','-'),'YYYY-FMMM-FMDD') AS trade_date,
  COALESCE(sd.account_name,'') AS account_name,
  UPPER(COALESCE(sd.flow_type,'')) AS flow_type,
  NULL AS category_id,
  NULLIF(sd.category_name,'') AS category_name,
  NULLIF(sd.category2,'')     AS category2_name,
  COALESCE(sd.amount,0) AS amount,
  CASE
    WHEN sd.currency IS NULL OR btrim(sd.currency)='' THEN 'JPY'
    WHEN upper(replace(btrim(sd.currency),' ','')) IN ('円','YEN','JPN') THEN 'JPY'
    WHEN upper(replace(btrim(sd.currency),' ','')) IN ('NT$','NTD','TWD') THEN 'TWD'
    WHEN upper(replace(btrim(sd.currency),' ','')) IN ('WBTC','XBT')     THEN 'BTC'
    ELSE upper(replace(btrim(sd.currency),' ',''))
  END AS currency,
  /* rate 計算は略：あなたの現行版（usd_rates/crypto_rates）をそのまま利用でOK */
  ...（あなたの現行の COALESCE( … ) AS rate をそのまま残す）... ,
  ...（同様に jpy_amount の COALESCE( … ) をそのまま残す）... ,
  COALESCE(sd.content,'') AS content,
  COALESCE(sd.memo,'')    AS memo,
  'csv' AS source,
  sd.shash AS source_hash,
  CASE sd.segment
    WHEN '法人資産' THEN 'corporate'
    WHEN '個人資産' THEN 'personal'
    WHEN '法人投資' THEN 'corporate_invest'
    WHEN '個人投資' THEN 'personal_invest'
    ELSE NULL
  END::app.segment_type AS segment
FROM src_dedup sd
ON CONFLICT (source_hash) DO UPDATE SET
  trade_date     = EXCLUDED.trade_date,
  account_name   = EXCLUDED.account_name,
  flow_type      = EXCLUDED.flow_type,
  category_name  = EXCLUDED.category_name,
  category2_name = EXCLUDED.category2_name,
  amount         = EXCLUDED.amount,
  currency       = EXCLUDED.currency,
  rate           = EXCLUDED.rate,
  jpy_amount     = EXCLUDED.jpy_amount,
  content        = EXCLUDED.content,
  memo           = EXCLUDED.memo,
  source         = EXCLUDED.source,
  segment        = EXCLUDED.segment;
    `);
    
    console.log("✓ INSERT completed. Rows affected:", result.rowCount);

    // staging テーブルをクリア
    await client.query("DELETE FROM staging.csv_import_raw");
    console.log("✓ Staging table cleared");

    await client.query("COMMIT");
    console.log("✓ Transaction committed");
    console.log("=== CSV Commit Success ===");
    
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("=== CSV Commit Error ===");
    console.error("Error message:", err.message);
    console.error("Error detail:", err.detail);
    console.error("Error hint:", err.hint);
    res.status(500).send("csv_commit_failed");
  } finally {
    client.release();
  }
});

// ===== 手入力の新規追加 API =====
app.post("/api/manual-entry", async (req, res) => {
  const client = await pool.connect();
  try {
    const body = req.body || {};

    const normStr = (v) => (v ?? "").toString().trim();
    const toNum = (v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const normalizeCurrency = (raw) => {
      const s0 = normStr(raw).toUpperCase();
      const s  = s0.replace(/[^A-Z]/g, "");
      if (!s) return null;
      if (["JPY","YEN","JPN"].includes(s)) return "JPY";
      if (["TWD","NTD"].includes(s))       return "TWD";
      if (["BTC","WBTC","XBT"].includes(s)) return "BTC";
      return s;
    };
    const normalizeFlow = (raw) => {
      const s = normStr(raw).toUpperCase();
      if (s === "IN")  return "IN";
      if (s === "OUT") return "OUT";
      if (s === "CF_IN")  return "CF_IN";
      if (s === "CF_OUT") return "CF_OUT";
      if (s === "CF" || s === "CASHFLOW" || s === "キャッシュフロー") return "CF_IN"; // 後方互換
      return null;
    };
    const normalizeSegment = (raw) => {
      const s = normStr(raw);
      if (["corporate","法人資産"].includes(s))        return "corporate";
      if (["personal","個人資産"].includes(s))         return "personal";
      if (["corporate_invest","法人投資"].includes(s)) return "corporate_invest";
      if (["personal_invest","個人投資"].includes(s))  return "personal_invest";
      return null;
    };

    const tradeDate     = normStr(body.trade_date);
    const accountName   = normStr(body.account_name);
    const flowType      = normalizeFlow(body.flow_type);
    const categoryName  = normStr(body.category_name || body.category || "");
    const category2Name = normStr(body.category2_name || body.category2 || "");
    const amount        = toNum(body.amount);
    const currency      = normalizeCurrency(body.currency);
    const rateCsv       = toNum(body.rate);
    const content       = normStr(body.content);
    const memo          = normStr(body.memo);
    const segment       = normalizeSegment(body.segment);

    console.log(
      '[POST/manual-entry] cur="%s" -> "%s" ym=%s',
      body.currency,
      currency,
      tradeDate?.slice(0,7)
    );

    // ▼ バリデーション
    if (!tradeDate || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
      return res.status(400).json({ error: "trade_date (YYYY-MM-DD) is required" });
    }
    if (!accountName) {
      return res.status(400).json({ error: "account_name is required" });
    }
    if (!flowType) {
      return res.status(400).json({ error: "flow_type must be IN/OUT/CF_IN/CF_OUT" });
    }
    if (amount === null || amount <= 0) {
      return res.status(400).json({ error: "amount must be > 0" });
    }
    if (!currency) {
      return res.status(400).json({ error: "currency is required" });
    }

    // ▼ レート取得（当月末レート or 直近月末のレート）
    const ym = tradeDate.slice(0, 7);
    let rateUsed = rateCsv;

    if (rateUsed === null) {
      if (currency === "BTC" || currency === "ETH") {
        const { rows } = await client.query(
          `SELECT c.usd_month_avg * f.rate_month_avg AS jpy_rate
             FROM app.crypto_usd_monthly c
             JOIN app.fx_rate_monthly f
               ON f.currency = 'USD'
              AND to_char(f.month_start,'YYYY-MM') = $1
            WHERE c.symbol = $2
              AND to_char(c.month_start,'YYYY-MM') = $1
            LIMIT 1`,
          [ym, currency]
        );
        rateUsed = rows?.[0]?.jpy_rate ?? null;
      } else if (currency === "JPY") {
        rateUsed = 1;
      } else if (["USDT","USDC"].includes(currency)) {
        const { rows } = await client.query(
          `SELECT rate_month_avg FROM app.fx_rate_monthly
            WHERE currency = 'USD'
              AND to_char(month_start,'YYYY-MM') = $1
            LIMIT 1`,
          [ym]
        );
        rateUsed = rows?.[0]?.rate_month_avg ?? null;
      } else {
        const { rows } = await client.query(
          `SELECT rate_month_avg
             FROM app.fx_rate_monthly
            WHERE currency = $1
              AND to_char(month_start,'YYYY-MM') = $2
            LIMIT 1`,
          [currency, ym]
        );
        rateUsed = rows?.[0]?.rate_month_avg ?? null;
      }
    }

    rateUsed = rateUsed == null ? null : Number(rateUsed);
    if (rateUsed === null || !(Number.isFinite(rateUsed) && rateUsed > 0)) {
      return res.status(400).json({
        error: `rate is missing and month-end rate not found for ${currency} in ${ym}`,
      });
    }

    const jpyAmount = Number((amount * rateUsed).toFixed(4));
    const source    = "manual";
    const sourceHash = crypto
      .createHash("md5")
      .update(
        `${source}:${tradeDate}:${accountName}:${flowType}:${categoryName}:${category2Name}:` +
        `${amount}:${currency}:${rateUsed}:${content}:${memo}:${segment || ""}`
      )
      .digest("hex");

    const sql = `
      WITH ins AS (
        INSERT INTO app.manual_entry
          (trade_date, account_name, flow_type,
           category_id, category_name, category2_name,
           amount, currency, rate, jpy_amount,
           content, memo, source, source_hash, segment)
        VALUES
          ($1,$2,$3,
           NULL,$4,$5,
           $6,$7,$8,$9,
           $10,$11,$12,$13,$14)
        ON CONFLICT (source_hash) DO NOTHING
        RETURNING id
      )
      SELECT id, true AS created FROM ins
      UNION ALL
      SELECT id, false AS created
        FROM app.manual_entry
       WHERE source_hash = $13
       ORDER BY created DESC
       LIMIT 1;
    `;

    const params = [
      tradeDate,          // 1
      accountName,        // 2
      flowType,           // 3
      categoryName || null,   // 4  ★カテゴリ1
      category2Name || null,  // 5  ★カテゴリ2
      amount,             // 6
      currency,           // 7
      rateUsed,           // 8
      jpyAmount,          // 9
      content || null,    // 10
      memo || null,       // 11
      source,             // 12
      sourceHash,         // 13
      segment             // 14
    ];

    const q   = await client.query(sql, params);
    const row = q.rows?.[0];
    if (!row) {
      return res.status(409).json({ error: "upsert failed: no row returned" });
    }

    return res.json({
      status: "ok",
      id: String(row.id),
      created: !!row.created,
      jpy_amount: jpyAmount,
      rate: rateUsed,
    });
  } catch (e) {
    console.error("manual_entry_insert_failed", e);
    return res.status(400).json({ error: e.message || "insert_failed" });
  } finally {
    client.release();
  }
});

app.put('/api/manual-entry/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const {
      segment,
      category2_name,
      amount,
      rate,
      content,
      memo,
      flow_type,
      currency,
      account,
      trade_date
    } = req.body || {};

    const sets = [];
    const vals = [];

    const pushSet = (sqlFrag, val) => {
      sets.push(`${sqlFrag}=$${vals.length + 1}`);
      vals.push(val);
    };

    if (segment != null && String(segment) !== '') pushSet('segment', String(segment));
    if (category2_name != null && String(category2_name) !== '') pushSet('category2_name', String(category2_name));
    if (content != null) pushSet('content', String(content));
    if (memo != null) pushSet('memo', String(memo));
    if (flow_type === 'IN' || flow_type === 'OUT') pushSet('flow_type', flow_type);
    if (currency != null && String(currency) !== '') pushSet('currency', String(currency));
    if (account != null && String(account) !== '') pushSet('account_name', String(account));
    if (trade_date != null && String(trade_date) !== '') pushSet('trade_date', String(trade_date));

    const hasAmount = amount != null && String(amount) !== '';
    const hasRate   = rate   != null && String(rate)   !== '';

    let amountParamNum = null;
    let rateParamNum = null;

    if (hasAmount) {
      amountParamNum = vals.length + 1;
      sets.push(`amount=CAST($${vals.length + 1} AS numeric(20,8))`);
      vals.push(String(amount));
    }
    if (hasRate) {
      rateParamNum = vals.length + 1;
      sets.push(`rate=CAST($${vals.length + 1} AS numeric(20,8))`);
      vals.push(String(rate));
    }

    if (hasAmount || hasRate) {
      const amountExpr = amountParamNum != null ? `$${amountParamNum}::numeric` : 'amount';
      const rateExpr = rateParamNum != null ? `$${rateParamNum}::numeric` : 'rate';
      sets.push(`jpy_amount = CAST(${amountExpr} * ${rateExpr} AS numeric(20,4))`);
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    vals.push(id);
    const sql = `
      UPDATE app.manual_entry
         SET ${sets.join(', ') }
       WHERE id = $${vals.length}
       RETURNING *;
    `;

    const result = await pool.query(sql, vals);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ status: 'ok', row: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});
app.get("/api/manual-entry", async (req, res) => {
  const client = await pool.connect();
  try {
    // await client.query("SET CLIENT_ENCODING TO 'UTF8'");
    const month = String(req.query.month ?? "").trim();
    const segment = String(req.query.segment ?? "total").trim();
    const currency = String(req.query.currency ?? "ALL").trim();
    const excludeTransfer = String(req.query.exclude_transfer ?? "true") === "true";

    if (!month) {
      return res.status(400).json({ error: "month param required (YYYY-MM)" });
    }

    const params = [`${month}-01`, segment, currency, excludeTransfer];

    const listSql = `
  SELECT
    m.id,
    m.trade_date AS date,
    m.account_name AS account,
    m.flow_type AS type,
    m.category_id,
    m.category_name AS category_name,
    m.category2_name,
    m.amount,
    m.currency,
    m.rate,
    m.jpy_amount,
    m.content,
    m.memo,
    m.segment
  FROM app.manual_entry m
  WHERE m.trade_date >= $1::date
    AND m.trade_date < ($1::date + INTERVAL '1 month')
    AND ($2 = 'total' OR m.segment = $2::app.segment_type)
    AND ($3 = 'ALL' OR m.currency = $3)
    -- 資金移動除外ONなら「資金移動(受取/送金)」を除外
    AND (CASE WHEN $4 THEN COALESCE(m.category2_name,'') NOT LIKE '資金移動%' ELSE TRUE END)
  ORDER BY m.trade_date, m.id
`;

const sumSql = `
  SELECT
    /* IN = 通常IN + (CF_IN かつ 月末残高) — 互換用に残す（DB側がIN化済でも二重計上しない） */
    COALESCE(SUM(
      CASE
        WHEN m.flow_type = 'IN'
          OR (m.flow_type = 'CF_IN' AND COALESCE(m.category2_name,'') = '月末残高')
        THEN m.jpy_amount
        ELSE 0
      END
    ), 0) AS in_jpy,

    /* OUT = 通常OUT */
    COALESCE(SUM(
      CASE WHEN m.flow_type = 'OUT' THEN m.jpy_amount ELSE 0 END
    ), 0) AS out_jpy,

    /* CF = CF_IN/CF_OUT から 月末残高 を除外した純資金移動 */
    COALESCE(SUM(
      CASE
        WHEN m.flow_type IN ('CF_IN','CF_OUT')
         AND COALESCE(m.category2_name,'') <> '月末残高'
        THEN m.jpy_amount
        ELSE 0
      END
    ), 0) AS cf_jpy,

    COALESCE(SUM(m.jpy_amount), 0) AS total_jpy
  FROM app.manual_entry m
  WHERE m.trade_date >= $1::date
    AND m.trade_date < ($1::date + INTERVAL '1 month')
    AND ($2 = 'total' OR m.segment = $2::app.segment_type)
    AND ($3 = 'ALL' OR m.currency = $3)
    AND (CASE WHEN $4 THEN COALESCE(m.category2_name,'') NOT LIKE '資金移動%' ELSE TRUE END)
`;

const sqlSummary = `
  WITH params AS (
    SELECT
      ($1)::date AS m,
      $2::text   AS seg,
      $3::text   AS cur,
      $4::boolean AS ex
  ),
  curr AS (
    SELECT
      COALESCE(SUM(
        CASE
          WHEN m.flow_type = 'IN'
            OR (m.flow_type = 'CF_IN' AND COALESCE(m.category2_name,'') = '月末残高')
          THEN m.jpy_amount
          ELSE 0
        END
      ),0) AS in_jpy,
      COALESCE(SUM(CASE WHEN m.flow_type='OUT' THEN m.jpy_amount ELSE 0 END),0) AS out_jpy
    FROM app.manual_entry m, params p
    WHERE m.trade_date >= p.m
      AND m.trade_date < (p.m + INTERVAL '1 month')
      AND (p.seg = 'total' OR m.segment = p.seg::app.segment_type)
      AND (p.cur = 'ALL' OR m.currency = p.cur)
      AND (CASE WHEN p.ex THEN COALESCE(m.category2_name,'') NOT LIKE '資金移動%' ELSE TRUE END)
  ),
  prev AS (
    SELECT
      COALESCE(SUM(CASE WHEN m.flow_type='IN'  THEN m.jpy_amount ELSE 0 END),0) AS in_jpy,
      COALESCE(SUM(CASE WHEN m.flow_type='OUT' THEN m.jpy_amount ELSE 0 END),0) AS out_jpy
    FROM app.manual_entry m, params p
    WHERE m.trade_date >= (p.m - INTERVAL '1 month')
      AND m.trade_date <  p.m
      AND (p.seg = 'total' OR m.segment = p.seg::app.segment_type)
      AND (p.cur = 'ALL' OR m.currency = p.cur)
      AND (CASE WHEN p.ex THEN COALESCE(m.category2_name,'') NOT LIKE '資金移動%' ELSE TRUE END)
  )
  SELECT
    curr.in_jpy AS in_jpy,
    curr.out_jpy AS out_jpy,
    (curr.in_jpy - curr.out_jpy) AS total_jpy,
    prev.in_jpy AS prev_in_jpy,
    prev.out_jpy AS prev_out_jpy,
    (prev.in_jpy - prev.out_jpy) AS prev_total_jpy
  FROM curr, prev;
`;

    const { rows } = await pool.query(listSql, params);
    const { rows: sumRows } = await pool.query(sqlSummary, params);

    const s = sumRows[0] || {
      in_jpy: 0,
      out_jpy: 0,
      total_jpy: 0,
      prev_in_jpy: 0,
      prev_out_jpy: 0,
      prev_total_jpy: 0,
    };

    const summary = {
      in_jpy: Number(s.in_jpy),
      out_jpy: Number(s.out_jpy),
      total_jpy: Number(s.total_jpy ?? Number(s.in_jpy) - Number(s.out_jpy)),
      prev_total_jpy: Number(s.prev_total_jpy),
      mom_diff_jpy:
        Number(s.total_jpy ?? Number(s.in_jpy) - Number(s.out_jpy)) -
        Number(s.prev_total_jpy),
    };

    return res.json({
      month,
      segment,
      currency,
      exclude_transfer: excludeTransfer,
      rows,
      summary,
    });
  } catch (e) {
    console.error("[manual-entry] error:", e);
    return res.status(500).json({ error: "internal" });
  }
});

// === 法定通貨: 日次→月平均(JPY/1通貨)を取得（多段フォールバック堅牢版） ===
// 手順：timeseries(base=JPY) → convert（日次）→ historical（日次）→ 1日/15日/月末の3点平均
async function fetchFiatDailyJpyBase(ym, symbols) {
  const [y, m] = String(ym).split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end   = new Date(Date.UTC(y, m, 0));
  const iso = (d) => d.toISOString().slice(0,10);

  // その月の全日
  const days = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(iso(d)); // 'YYYY-MM-DD'
  }

  // 3点法（最終フォールバック用）
  const triDates = [
    iso(new Date(Date.UTC(y, m - 1, 1))),                                // 1日
    iso(new Date(Date.UTC(y, m - 1, Math.min(15, end.getUTCDate())))),   // 15日(なければ月末より前)
    iso(end),                                                            // 月末
  ];

  const out = {}; // { CCY: avg(JPY per 1 ccy) }

  for (const raw of (symbols || [])) {
    const ccy = String(raw || '').trim().toUpperCase();
    if (!ccy || ccy === 'JPY') { continue; }

    // =============== 1) timeseries（base=JPY, symbols=CCY） ===============
    try {
      const url = `https://api.exchangerate.host/timeseries?base=JPY&symbols=${encodeURIComponent(ccy)}&start_date=${iso(start)}&end_date=${iso(end)}`;
      const r = await fetch(url, { headers: { accept: 'application/json' } });
      if (r.ok) {
        const j = await r.json();
        const daily = Object.values(j?.rates || {})
          .map((obj) => Number(obj?.[ccy]))
          .filter((v) => Number.isFinite(v) && v > 0)
          // JPY→CCY（1JPYあたりのCCY）→ 逆数にして JPY/1CCY へ
          .map((v) => 1 / v);

        if (daily.length > 0) {
          const avg = daily.reduce((a,b)=>a+b,0)/daily.length;
          out[ccy] = avg;
          await new Promise(res => setTimeout(res, 100));
          continue; // 次の通貨へ
        }
      } else {
        // 何もせずフォールバックへ
      }
    } catch (e) { /* ignore → fallback */ }

    // =============== 2) convert（日次ループ） ===============
    const samples2 = [];
    for (const d of days) {
      try {
        const u = `https://api.exchangerate.host/convert?from=JPY&to=${encodeURIComponent(ccy)}&amount=1&date=${d}`;
        const r = await fetch(u, { headers: { accept: 'application/json' } });
        if (!r.ok) { await new Promise(res=>setTimeout(res,60)); continue; }
        const j = await r.json();
        const v = Number(j?.result); // CCY per 1 JPY
        if (Number.isFinite(v) && v > 0) {
          samples2.push(1 / v);      // JPY per 1 CCY
        }
      } catch {}
      await new Promise(res => setTimeout(res, 60));
    }
    if (samples2.length > 0) {
      const avg = samples2.reduce((a,b)=>a+b,0)/samples2.length;
      out[ccy] = avg;
      continue;
    }

    // =============== 3) historical/day（日次ループ） ===============
    const samples3 = [];
    for (const d of days) {
      try {
        const u = `https://api.exchangerate.host/${d}?base=JPY&symbols=${encodeURIComponent(ccy)}`;
        const r = await fetch(u, { headers: { accept: 'application/json' } });
        if (!r.ok) { await new Promise(res=>setTimeout(res,60)); continue; }
        const j = await r.json();
        const v = Number(j?.rates?.[ccy]); // CCY per 1 JPY
        if (Number.isFinite(v) && v > 0) {
          samples3.push(1 / v);           // JPY per 1 CCY
        }
      } catch {}
      await new Promise(res => setTimeout(res, 60));
    }
    if (samples3.length > 0) {
      const avg = samples3.reduce((a,b)=>a+b,0)/samples3.length;
      out[ccy] = avg;
      continue;
    }

    // =============== 4) 最終フォールバック：3点法 ===============
    const samples4 = [];
    for (const d of triDates) {
      try {
        const u = `https://api.exchangerate.host/${d}?base=JPY&symbols=${encodeURIComponent(ccy)}`;
        const r = await fetch(u, { headers: { accept: 'application/json' } });
        if (!r.ok) continue;
        const j = await r.json();
        const v = Number(j?.rates?.[ccy]);
        if (Number.isFinite(v) && v > 0) {
          samples4.push(1 / v);
        }
      } catch {}
      await new Promise(res => setTimeout(res, 80));
    }
    if (samples4.length > 0) {
      const avg = samples4.reduce((a,b)=>a+b,0)/samples4.length;
      out[ccy] = avg;
    } else {
      console.warn('[fiat fetch] no samples for', ccy, ym);
    }
  }

  return out;
}

// ===== ステーブル通貨（USDT/USDC）を USD 月末レートにペグする（Node pg 対応版） =====
async function pegStablecoinsToUsd(ym) {
  const client = await pool.connect();
  try {
    // まず USD のレートを取得（rate_ttmを月末として使う）
    const { rows } = await client.query(
      `SELECT rate_ttm
         FROM app.fx_rate_monthly
        WHERE currency='USD'
          AND to_char(month_start,'YYYY-MM') = $1
        LIMIT 1`,
      [ym]
    );
    if (!rows || rows.length === 0) {
      console.warn('[peg] no USD rate_ttm for', ym);
      return;
    }
    const usdRate = rows[0].rate_ttm;

    await client.query('BEGIN');

    // USDT をペグ
    await client.query(
      `INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
       VALUES ('USDT', to_date($1||'-01','YYYY-MM'), $2::numeric, $2::numeric, 'peg-USD')
       ON CONFLICT (currency, month_start)
       DO UPDATE SET rate_month_avg=EXCLUDED.rate_month_avg,
                     rate_ttm      =EXCLUDED.rate_ttm,
                     source        =EXCLUDED.source`,
      [ym, usdRate]
    );

    // USDC をペグ
    await client.query(
      `INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
       VALUES ('USDC', to_date($1||'-01','YYYY-MM'), $2::numeric, $2::numeric, 'peg-USD')
       ON CONFLICT (currency, month_start)
       DO UPDATE SET rate_month_avg=EXCLUDED.rate_month_avg,
                     rate_ttm      =EXCLUDED.rate_ttm,
                     source        =EXCLUDED.source`,
      [ym, usdRate]
    );

    await client.query('COMMIT');
    console.log('[peg] pegged USDT/USDC to USD for', ym);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.warn('[peg] failed', ym, e.message || e);
  } finally {
    client.release();
  }
}

// ---- 月平均を適用（rate & jpy_amount 再計算）
async function applyMonthAvgRatesFor(ym, recalc = true) {
  const client = await pool.connect();
  try {
    const sql = `
      SELECT app.apply_month_avg_rates($1::text, $2::boolean) AS updated;
    `;
    const { rows } = await client.query(sql, [ym, !!recalc]);
    console.log('[apply] apply_month_avg_rates(%s) updated rows = %s', ym, rows?.[0]?.updated ?? 0);
  } catch (e) {
    console.warn('[apply] failed', ym, e.message || e);
  } finally {
    client.release();
  }
}

// 指定した "YYYY-MM" の月末日を UTC で返す
function monthEndDateUTC(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)); // mは1始まり、0日は前月末
}

// 前月の "YYYY-MM" 文字列を返す
function prevMonthStr(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

// 今が指定月の月末より前なら前月末日、それ以外はその月末日を採用
function effectiveMonthEndISO(ym) {
  const end = monthEndDateUTC(ym);
  const now = new Date();
  if (now < end) {
    const prev = prevMonthStr(ym);
    return monthEndDateUTC(prev).toISOString().slice(0, 10);
  }
  return end.toISOString().slice(0, 10);
}

// 月末レート(JPY/1通貨)を取得（Frankfurterのみ）
async function fetchFiatMonthEndJpyBase(ym, symbols) {
  const endISO = effectiveMonthEndISO(ym);  // "YYYY-MM-DD"
  const results = {};

  for (const raw of (symbols || [])) {
    const ccy = String(raw || '').trim().toUpperCase();
    if (!ccy) continue;

    // JPY は常に 1
    if (ccy === 'JPY') {
      results[ccy] = 1;
      continue;
    }

    const url = `https://api.frankfurter.app/${endISO}?from=${ccy}&to=JPY`;

    try {
      const r = await fetch(url, { headers: { accept: "application/json" } });

      if (!r.ok) {
        console.warn('[fiat month-end] http error', r.status, 'for', ccy, ym, url);
        results[ccy] = null;
        continue;
      }

      const j = await r.json();
      const v = Number(j && j.rates && j.rates.JPY);

      if (Number.isFinite(v) && v > 0) {
        // base=ccy, to=JPY → 1 ccy あたり何 JPY か
        results[ccy] = v;   // JPY per 1 ccy
      } else {
        console.warn('[fiat month-end] invalid json from frankfurter', ccy, ym);
        results[ccy] = null;
      }
    } catch (e) {
      console.warn('[fiat month-end] frankfurter error', ccy, ym, e && e.message ? e.message : e);
      results[ccy] = null;
    }
  }

  return results;
}

// ===== Fixer.io: 月末レート(JPY/1通貨)取得ヘルパー =====
async function fetchFixerMonthEndJpyBase(ym, symbols) {
  const apiKey  = process.env.FIXER_API_KEY;
  const baseUrl = process.env.FIXER_API_BASE || "https://data.fixer.io/api";
  const timeoutMs = Number(process.env.FIXER_TIMEOUT_MS || 10000);

  if (!apiKey) {
    console.warn("[fixer] FIXER_API_KEY is not set – skip fiat rates for", ym);
    return {};
  }

  // ym = '2025-07' → month-end = '2025-07-31'
  const [y, m] = ym.split("-").map((v) => Number(v));
  const monthStart = new Date(Date.UTC(y, m - 1, 1));
  const monthEnd = new Date(Date.UTC(y, m, 0)); // 次月0日 = 月末
  const dateStr = monthEnd.toISOString().slice(0, 10); // 'YYYY-MM-DD'

  // Fixer Free は base=EUR 固定なので、EUR→JPY, EUR→各通貨 を取得して
  // JPY/1通貨 = (JPY_per_EUR / CCY_per_EUR) で逆算する
  const wanted = Array.from(
    new Set(["JPY", ...(symbols || [])])
  ); // JPY を必ず含める

  const url =
    `${baseUrl}/${dateStr}` +
    `?access_key=${encodeURIComponent(apiKey)}` +
    `&symbols=${encodeURIComponent(wanted.join(","))}` +
    `&format=1`;

  console.log("[fixer] month-end request", { ym, dateStr, url });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn("[fiat month-end] fixer http", res.status, ym, url);
      return {};
    }

    const json = await res.json();
    if (!json || json.success === false || !json.rates) {
      console.warn("[fiat month-end] invalid json from fixer", ym, json?.error || json);
      return {};
    }

    const rates = json.rates; // { EUR→JPY, EUR→USD, ... } (1 EUR = rate 単位)

    if (typeof rates.JPY !== "number" || !Number.isFinite(rates.JPY)) {
      console.warn("[fiat month-end] fixer response has no usable JPY rate", ym, rates);
      return {};
    }

    const jpyPerEur = rates.JPY;
    const out = {};

    for (const ccy of wanted) {
      if (ccy === "JPY") {
        out["JPY"] = 1; // 1 JPY = 1 JPY
        continue;
      }
      const eurRate = rates[ccy];
      if (typeof eurRate !== "number" || !Number.isFinite(eurRate) || eurRate === 0) {
        continue;
      }
      // 1 CCY あたりの JPY
      const jpyPerUnit = jpyPerEur / eurRate;
      out[ccy] = jpyPerUnit;
    }

    console.log("[fiat month-end] fixer result", ym, out);
    return out; // { USD: 149.85, EUR: 171.52, ... }
  } catch (e) {
    console.warn("[fiat month-end] fixer error", ym, e?.message || e);
    return {};
  } finally {
    clearTimeout(timer);
  }
}

// ===== Fixer 月末レート → app.fx_rate_monthly へ反映 =====
async function upsertFiatMonthEndRates(ym, symbols) {
  if (!symbols || symbols.length === 0) {
    return { ym, ok: true, upserted: [] };
  }

  // Fixer から「その月の月末レート(JPY/1通貨)」を取得
  const jpyMap = await fetchFixerMonthEndJpyBase(ym, symbols);
  const keys = Object.keys(jpyMap || {}).filter((c) => c && c !== "JPY");
  if (keys.length === 0) {
    console.warn("[upsertFiatMonthEndRates] no fiat rates for", ym);
    return { ym, ok: false, upserted: [] };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const upserted = [];

    for (const ccy of keys) {
      const v = jpyMap[ccy];
      if (!Number.isFinite(v) || v <= 0) continue;

      // month_start は その月の1日固定。rate_month_avg / rate_ttm に同じ値を入れる
      await client.query(
        `
        INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
        VALUES ($1, ($2 || '-01')::date, $3::numeric, $3::numeric, 'fixer-monthend')
        ON CONFLICT (currency, month_start)
        DO UPDATE SET
          rate_month_avg = EXCLUDED.rate_month_avg,
          rate_ttm       = EXCLUDED.rate_ttm,
          source         = EXCLUDED.source
        `,
        [ccy, ym, v]
      );
      upserted.push(ccy);
    }

    await client.query("COMMIT");
    console.log("[upsertFiatMonthEndRates] upserted", ym, upserted);
    return { ym, ok: true, upserted };
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[upsertFiatMonthEndRates] failed", ym, e);
    return { ym, ok: false, error: e.message };
  } finally {
    client.release();
  }
}

async function fetchCryptoUsdDaily(ym, id) {
  const { start, end } = monthRange(ym);
  const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart/range?vs_currency=usd&from=${Math.floor(start.getTime()/1000)}&to=${Math.floor(end.getTime()/1000)}`;

  // 429 対策：指数バックオフで最大3回リトライ
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (r.status === 429) {
      const waitMs = 500 * Math.pow(2, attempt); // 500ms → 1000ms → 2000ms
      await new Promise(res => setTimeout(res, waitMs));
      continue;
    }
    if (!r.ok) throw new Error(`CG daily fetch failed: ${id} ${r.status}`);

    const j = await r.json();
    const prices = Array.isArray(j.prices) ? j.prices : [];
    const inMonth = prices
      .map(([ts, price]) => ({ ts: new Date(ts), price: Number(price) }))
      .filter((p) => p.ts >= start && p.ts <= end)
      .map((p) => p.price)
      .filter((n) => Number.isFinite(n));
    return inMonth;
  }

  // 3回とも429だった場合
  throw new Error(`CG daily fetch failed: ${id} 429`);
}  // ← ここで関数を閉じる！

// 関数の外に定義
const COINGECKO_IDS = { BTC: "bitcoin", ETH: "ethereum" };

async function upsertCryptoMonthAverages(ym, symbols) {
  if (!symbols || symbols.length === 0) return { ym, ok: true, upserted: [] };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const upserted = [];
    for (const sym of symbols) {
      const id = COINGECKO_IDS[sym];
      if (!id) {
        console.warn("[sync] unknown crypto symbol", sym);
        continue;
      }
      const d = await fetchCryptoUsdDaily(ym, id);
      const mAvg = avg(d);
      if (mAvg && Number.isFinite(mAvg)) {
        await client.query(
          `INSERT INTO app.crypto_usd_monthly (symbol, month_start, usd_month_avg)
           VALUES ($1, $2::date, $3::numeric)
           ON CONFLICT (symbol, month_start)
           DO UPDATE SET usd_month_avg = EXCLUDED.usd_month_avg`,
          [sym, `${ym}-01`, mAvg]
        );
        upserted.push(sym);
      }
    }
    await client.query("COMMIT");
    return { ym, ok: true, upserted };
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[upsertCryptoMonthAverages] failed:", e);
    return { ym, ok: false, error: e.message };
  } finally {
    client.release();
  }
}

// ===== USDT / USDC を USD にペグするヘルパー =====
async function pegUsdStableCoins(ym) {
  const client = await pool.connect();
  try {
    // 月に対応する USD レートを取得
    const sql = `
      WITH usd AS (
        SELECT month_start, rate_month_avg, rate_ttm
        FROM app.fx_rate_monthly
        WHERE currency = 'USD'
          AND to_char(month_start,'YYYY-MM') = $1
        LIMIT 1
      )
      INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
      SELECT s.sym, u.month_start, u.rate_month_avg, u.rate_ttm, 'peg-USD'
      FROM usd u
      JOIN (VALUES ('USDT'), ('USDC')) AS s(sym) ON TRUE
      ON CONFLICT (currency, month_start)
      DO UPDATE SET
        rate_month_avg = EXCLUDED.rate_month_avg,
        rate_ttm       = EXCLUDED.rate_ttm,
        source         = EXCLUDED.source;
    `;
    const { rowCount } = await client.query(sql, [ym]);
    console.log('[peg] pegged USDT/USDC to USD for', ym, '(rows=', rowCount, ')');
    return { ym, ok: true, rows: rowCount };
  } catch (e) {
    console.error('[peg] failed', ym, e.message || e);
    return { ym, ok: false, error: e.message || String(e) };
  } finally {
    client.release();
  }
}

async function syncMonthRates(ym) {
  const uni = await getCurrencyUniverse();
  const fiatTargets   = uni.fiat.filter((c) => c !== "JPY");
  const cryptoTargets = uni.crypto;

  // 法定通貨：Fixer の月末レートで更新
  const rFiat = await upsertFiatMonthEndRates(ym, fiatTargets);

  // 仮想通貨：既存どおり CoinGecko から月次レートを取得
  const rCrypto = await upsertCryptoMonthAverages(ym, cryptoTargets);

  // USDT / USDC を USD にペグ
  try {
    await pegUsdStableCoins(ym);
  } catch (e) {
    console.warn("[peg] failed", ym, e?.message || e);
  }

  // その月の全取引を「最新の fx_rate_monthly ベース」で再計算
  try {
    const { rows } = await pool.query(
      `SELECT app.apply_month_avg_rates($1::text, TRUE) AS updated_rows`,
      [ym]
    );
    console.log("[apply] apply_month_avg_rates(%s) updated rows = %s",
      ym,
      rows?.[0]?.updated_rows ?? "n/a"
    );
  } catch (e) {
    console.error("[apply] apply_month_avg_rates failed", ym, e);
  }

  return { ym, ok: true, universe: uni, fiat: rFiat, crypto: rCrypto };
}

function resolveTargetMonths(qMonth) {
  if (qMonth && /^\d{4}-\d{2}$/.test(qMonth)) return [qMonth];
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const ymNow = `${y}-${String(m).padStart(2, "0")}`;
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const ymPrev = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
  return [ymPrev, ymNow];
}

app.post("/admin/rates/sync", async (req, res) => {
  try {
    const qMonth = (req.query.month || "").toString().trim();
    const months = resolveTargetMonths(qMonth);
    const results = [];
    for (const ym of months) results.push(await syncMonthRates(ym));
    res.json({ status: "ok", results });
  } catch (e) {
    console.error("[admin/rates/sync] error", e);
    res.status(500).json({ error: e.message || "sync_failed" });
  }
});

cron.schedule(
  "10 19 * * *",
  async () => {
    try {
      const months = resolveTargetMonths(null);
      console.log("[CRON] rates sync start", months);
      for (const ym of months) {
        const r = await syncMonthRates(ym);
        console.log("[CRON] sync result", r);
      }
      console.log("[CRON] rates sync done");
    } catch (e) {
      console.error("[CRON] rates sync failed", e);
    }
  },
  { scheduled: true, timezone: "UTC" }
);



app.get('/api/admin/users', async (req, res) => {
  try {
    const sql = `
      SELECT
        id,
        name,
        email,
        role,
        to_char(last_login,'YYYY-MM-DD HH24:MI') AS "lastLogin"
      FROM app.users
      ORDER BY id
    `;
    const { rows } = await pool.query(sql);
    res.json({ rows: rows || [] });
  } catch (e) {
    console.error('[admin/users] error', e);
    res.status(500).json({ error: 'admin users fetch failed' });
  }
});

app.post('/api/admin/users', async (req, res) => {
  try {
    const { name, email, role = 'viewer', mfaEnabled = false, active = true } = req.body || {};
    if (!name || !email) return res.status(400).json({ error: 'name/email required' });

    const sql = `
      INSERT INTO app.users (name, email, role, mfa_enabled, active, last_login)
      VALUES ($1, $2, $3, $4, $5, NULL)
      RETURNING
        id, name, email, role,
        mfa_enabled AS "mfaEnabled",
        active,
        to_char(last_login,'YYYY-MM-DD HH24:MI') AS "lastLogin"
    `;
    const { rows } = await pool.query(sql, [name, email, role, !!mfaEnabled, !!active]);
    res.json(rows[0]);
  } catch (e) {
    console.error('[admin/users POST] error', e);
    res.status(500).json({ error: 'admin users create failed' });
  }
});

app.put('/api/admin/users/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, email, role, mfaEnabled, active } = req.body || {};
    const sql = `
      UPDATE app.users
      SET
        name        = COALESCE($1, name),
        email       = COALESCE($2, email),
        role        = COALESCE($3, role),
        mfa_enabled = COALESCE($4, mfa_enabled),
        active      = COALESCE($5, active)
      WHERE id = $6
      RETURNING
        id, name, email, role,
        mfa_enabled AS "mfaEnabled",
        active,
        to_char(last_login,'YYYY-MM-DD HH24:MI') AS "lastLogin"
    `;
    const vals = [
      name ?? null,
      email ?? null,
      role ?? null,
      typeof mfaEnabled === 'boolean' ? mfaEnabled : null,
      typeof active === 'boolean' ? active : null,
      id
    ];
    const { rows } = await pool.query(sql, vals);
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[admin/users PUT] error', e);
    res.status(500).json({ error: 'admin users update failed' });
  }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await pool.query('DELETE FROM app.users WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[admin/users DELETE] error', e);
    res.status(500).json({ error: 'admin users delete failed' });
  }
});

let adminSettings = { rateMode: 'avg', autoAggregation: true };

app.get('/api/admin/settings', (req, res) => {
  try {
    res.json(adminSettings);
  } catch (e) {
    res.status(500).json({ error: 'settings fetch failed' });
  }
});

app.put('/api/admin/settings', async (req, res) => {
  try {
    const { rateMode, autoAggregation } = req.body || {};
    if (rateMode && ['avg', 'trade', 'ttm'].includes(rateMode)) {
      adminSettings.rateMode = rateMode;
    }
    if (typeof autoAggregation === 'boolean') {
      adminSettings.autoAggregation = autoAggregation;
    }
    res.json(adminSettings);
  } catch (e) {
    res.status(500).json({ error: 'settings update failed' });
  }
});

app.get('/api/rates', async (req, res) => {
  const year = Number(req.query.year || new Date().getFullYear());
  const symbols = String(req.query.symbols || 'USD,AED,NTD,EUR')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

  const months = Array.from({ length: 12 }, (_, i) => ({ month: `${i + 1}月` }));

  try {
    const sql = `
      SELECT year, month, UPPER(symbol) AS symbol, rate
      FROM app.fx_rate_monthly
      WHERE year = $1 AND symbol = ANY($2)
    `;
    const { rows } = await pool.query(sql, [year, symbols]);

    const map = new Map();
    for (const r of rows) {
      const m = Number(r.month);
      if (!map.has(m)) map.set(m, {});
      map.get(m)[r.symbol] = Number(r.rate);
    }
    for (let i = 1; i <= 12; i++) {
      Object.assign(months[i - 1], map.get(i) || {});
    }
    return res.json(months);
  } catch (e) {
    console.warn('[rates] fallback empty:', e.message || e);
    return res.json(months);
  }
});
app.listen(PORT, () => {
  console.log(`Rates API listening on http://localhost:${PORT}`);
});