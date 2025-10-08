// rates-api.js (Express版・PG・自己署名SSL許可の開発設定)
// エンドポイント：
//  GET  /api/rates?year=YYYY&mode=avg|ttm&symbols=USD,EUR
//  GET  /api/dashboard/summary?month=YYYY-MM&mode=avg
//  GET  /api/dashboard/monthly?year=YYYY&mode=avg
//  GET  /api/manual-entry?month=YYYY-MM&segment=total|corporate|personal&currency=ALL|USD&exclude_transfer=true
//  POST /api/csv-import              (multipart/form-data, field: file)
//  POST /api/csv-import/commit       (staging → app.manual_entry へ反映)

// ▼ dotenv（最上段で .env を読み込む）
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import pg from 'pg';

// ▼ CSVアップロード用
import multer from 'multer';
import { parse } from 'csv-parse/sync';

const { Pool } = pg;

// --- 環境変数 ---
const { DATABASE_URL = '', PORT = 3001 } = process.env;
console.log('DEBUG DATABASE_URL =', DATABASE_URL);

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL が未設定です');
  process.exit(1);
}

// ⚠ 開発用: 自己署名証明書を許可
//   本番は RDS CA 証明書で verify-full を推奨（sslmode=verify-full & CA 設定に切替）
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// --- Express アプリ ---
const app = express();
app.use(express.json()); // JSONボディ

// 共通：キャッシュ抑止
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ========== /api/rates ==========
app.get('/api/rates', async (req, res) => {
  try {
    const year = String(req.query.year || '2025');
    const mode = String(req.query.mode || 'avg'); // 'avg' | 'ttm'
    const symbols = String(req.query.symbols || 'USD')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const client = await pool.connect();
    try {
      const table = {};
      for (const symbol of symbols) {
        const { rows } = await client.query(
          `SELECT date, rate_month_avg, rate_ttm
             FROM app.fx_rate_monthly
            WHERE ccy = $1 AND date BETWEEN $2 AND $3
            ORDER BY date`,
          [symbol, `${year}-01-01`, `${year}-12-31`],
        );
        for (const r of rows) {
          const ym = r.date.toISOString().slice(0, 7);
          table[ym] ||= {};
          table[ym][symbol] = mode === 'ttm' ? Number(r.rate_ttm) : Number(r.rate_month_avg);
        }
      }
      res.json({ base: 'JPY', year, mode, table });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('rates_query_failed', e);
    res.status(500).json({ error: 'failed_to_fetch_rates' });
  }
});

// ========== /api/dashboard/summary ==========
app.get('/api/dashboard/summary', async (req, res) => {
  try {
    const month = String(req.query.month ?? '').trim();
    const view = String(req.query.view ?? 'total').trim();
    const mode = String(req.query.mode ?? 'avg').trim();

    if (!month) {
      return res.status(400).json({ error: 'month param required (YYYY-MM)' });
    }

    const sql = `
      WITH current AS (
        SELECT SUM(me.jpy_amount) AS now
        FROM app.manual_entry me
        WHERE to_char(me.trade_date,'YYYY-MM') = $1
          AND ($2 = 'total' OR me.segment = $2::app.segment_type)
      ),
      previous AS (
        SELECT SUM(me.jpy_amount) AS prev
        FROM app.manual_entry me
        WHERE to_char(me.trade_date,'YYYY-MM') = (
          to_char(to_date($1,'YYYY-MM') - interval '1 month','YYYY-MM')
        )
          AND ($2 = 'total' OR me.segment = $2::app.segment_type)
      )
      SELECT $1 AS month, $2 AS view,
             COALESCE(c.now,0) AS now, COALESCE(p.prev,0) AS prev
      FROM current c CROSS JOIN previous p;
    `;

    const params = [month, view];
    const { rows } = await pool.query(sql, params);

    const row = rows[0] || { now: 0, prev: 0 };
    const out = {
      month,
      rate_mode: mode,
      by_view: {
        total: { now: row.now, prev: row.prev },
        corporate: { now: row.now, prev: row.prev },
        personal: { now: row.now, prev: row.prev },
      },
    };

    return res.json(out);
  } catch (e) {
    console.error('dashboard_summary_query_failed', e);
    return res.status(500).send(e.stack || String(e));
  }
});

// ========== /api/dashboard/monthly ==========
app.get('/api/dashboard/monthly', async (req, res) => {
  try {
    const year = String(req.query.year ?? '').trim() || new Date().getFullYear().toString();
    const view = String(req.query.view ?? 'total').trim();
    const mode = String(req.query.mode ?? 'avg').trim();

    console.log('HIT /api/dashboard/monthly', { year, view, mode, ts: new Date().toISOString() });

    const sql = `
      SELECT
        to_char(date_trunc('month', me.trade_date), 'YYYY-MM') AS ym,
        SUM(me.jpy_amount) AS total
      FROM app.manual_entry AS me
      WHERE EXTRACT(YEAR FROM me.trade_date) = $1::int
        AND (
          $2 = 'total'
          OR me.segment = $2::app.segment_type
        )
      GROUP BY 1
      ORDER BY 1;
    `;
    const params = [year, view];
    const { rows } = await pool.query(sql, params);

    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    const byMonth = new Map(rows.map((r) => [String(r.ym), Number(r.total || 0)]));

    const out = months.map((ym, idx) => ({
      month: `${idx + 1}月`,
      合計: byMonth.get(ym) ?? 0,
    }));

    return res.json(out);
  } catch (e) {
    console.error('dashboard_monthly_query_failed', e);
    return res.status(500).send(e.stack || String(e));
  }
});

// ========== /api/csv-import ==========
// CSVを受け取り、staging.csv_import_raw に投入（multerエラーも確実に捕捉）
const upload = multer({ storage: multer.memoryStorage() });

// ❶ 先に multer を明示的に実行してエラーを取得
app.post(
  '/api/csv-import',
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        console.error('multer_error', err);
        return res.status(500).json({ error: 'multer', message: err.message });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      console.log('HIT /api/csv-import', {
        hasFile: !!req.file,
        name: req?.file?.originalname,
        size: req?.file?.size,
        ts: new Date().toISOString(),
      });

      if (!req.file) return res.status(400).json({ error: 'file is required' });

      const text = req.file.buffer.toString('utf-8');
      const records = parse(text, { columns: true, skip_empty_lines: true, trim: true });

      // ✅ ここで毎回最新の接続情報から Pool を生成（searchParams エラー回避）
      const localPool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      });
      const client = await localPool.connect();

      try {
        let i = 0;
        for (const r of records) {
          i += 1;
          await client.query(
            `INSERT INTO staging.csv_import_raw
             (source_file, row_num, trade_date, account_name, flow_type, category_name, amount, currency, rate, jpy_amount, memo, segment)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              req.file.originalname,
              i,
              r.trade_date || null,
              r.account || null,
              r.flow_type || null,
              r.category || null,
              r.amount ? Number(r.amount) : null,
              r.currency || null,
              r.rate ? Number(r.rate) : null,
              r.jpy_amount ? Number(r.jpy_amount) : null,
              r.memo || null,
              r.segment || null,
            ],
          );
        }
        return res.json({ inserted: records.length });
      } finally {
        client.release();
        await localPool.end();
      }
    } catch (e) {
      console.error('csv_import_failed', e);
      return res.status(500).json({
        error: 'internal',
        message: e?.message || String(e),
        stack: e?.stack || null,
      });
    }
  },
);

// ========== /api/csv-import/commit ==========
app.post('/api/csv-import/commit', async (req, res) => {
  try {
    const client = await pool.connect();
    try {
      const insertSql = `
  INSERT INTO app.manual_entry
  (trade_date, account_name, flow_type, category_id, category2_name, amount, currency, rate, jpy_amount, memo, source, source_hash, segment)
  SELECT
    trade_date,
    account_name,
    UPPER(flow_type),
    NULL,                 -- category_id は未解決のため NULL
    category2_name,       -- ★ 追加：カテゴリ2を反映
    amount,
    currency,
    rate,
    jpy_amount,
    memo,
    'csv' AS source,
    md5(
      coalesce(source_file,'') || ':' ||
      row_num || ':' ||
      coalesce(trade_date::text,'') || ':' ||
      coalesce(account_name,'') || ':' ||
      coalesce(flow_type,'') || ':' ||
      coalesce(category_name,'') || ':' ||
      coalesce(category2_name,'') || ':' ||   // ★ 追加：ハッシュにも反映
      coalesce(amount::text,'') || ':' ||
      coalesce(currency,'') || ':' ||
      coalesce(rate::text,'') || ':' ||
      coalesce(jpy_amount::text,'') || ':' ||
      coalesce(memo,'') || ':' ||
      coalesce(segment,'')
    ) AS source_hash,
    CASE segment
      WHEN '法人資産' THEN 'corporate'
      WHEN '個人資産' THEN 'personal'
      WHEN '法人投資' THEN 'corporate_invest'
      WHEN '個人投資' THEN 'personal_invest'
      ELSE NULL
    END::app.segment_type
  FROM staging.csv_import_raw
  ON CONFLICT DO NOTHING;
`;
      const { rowCount } = await client.query(insertSql);
      await client.query('DELETE FROM staging.csv_import_raw'); // staging の掃除
      return res.json({ committed: rowCount });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('csv_commit_failed', e);
    return res.status(500).json({ error: 'internal', message: e?.message || String(e) });
  }
});

// デバッグ用：環境変数確認
app.get('/debug/env', (req, res) => {
  res.json({ DATABASE_URL: process.env.DATABASE_URL });
});

// ========== /api/manual-entry ==========
app.get('/api/manual-entry', async (req, res) => {
  try {
    const month = String(req.query.month ?? '').trim(); // YYYY-MM
    const segment = String(req.query.segment ?? 'total').trim();
    const currency = String(req.query.currency ?? 'ALL').trim();
    const excludeTransfer = String(req.query.exclude_transfer ?? 'true') === 'true';

    if (!month) {
      return res.status(400).json({ error: 'month param required (YYYY-MM)' });
    }

    const params = [`${month}-01`, segment, currency, excludeTransfer];

    const listSql = `
      SELECT
        m.id,
        m.trade_date AS date,
        m.account_name AS account,
        m.flow_type AS type,
        m.category_id,
        COALESCE(c.category_name,'') AS category_name,
        m.category2_name,               -- ★ 追加：カテゴリ2
        m.amount,
        m.currency,
        m.rate,
        m.jpy_amount,
        m.memo,
        m.segment
      FROM app.manual_entry m
      LEFT JOIN app.manual_entry_category c ON c.id = m.category_id
      WHERE date_trunc('month', m.trade_date) = $1::date
        AND ($2 = 'total' OR m.segment = $2::app.segment_type)
        AND ($3 = 'ALL' OR m.currency = $3)
        AND (CASE WHEN $4 THEN COALESCE(c.category_name,'') <> '資金移動' ELSE TRUE END)
      ORDER BY m.trade_date, m.id
    `;

    // ▼ 今月・前月のサマリー（同一フィルタを適用）を一括取得
const sqlSummary = `
WITH params AS (
  SELECT
    ($1)::date AS m,          -- 例: '2025-10-01'
    $2::text   AS seg,        -- total|corporate|personal|corporate_invest|personal_invest
    $3::text   AS cur,        -- ALL|USD|JPY|...
    $4::boolean AS ex         -- 資金移動を除外するか
),
curr AS (
  SELECT
    COALESCE(SUM(CASE WHEN m.flow_type = 'IN'  THEN m.jpy_amount END), 0) AS in_jpy,
    COALESCE(SUM(CASE WHEN m.flow_type = 'OUT' THEN m.jpy_amount END), 0) AS out_jpy
  FROM app.manual_entry m
  LEFT JOIN app.manual_entry_category c ON c.id = m.category_id
  , params p
  WHERE date_trunc('month', m.trade_date) = date_trunc('month', p.m)
    AND (p.seg = 'total' OR m.segment = p.seg::app.segment_type)
    AND (p.cur = 'ALL' OR m.currency = p.cur)
    AND (CASE WHEN p.ex THEN COALESCE(c.category_name,'') <> '資金移動' ELSE TRUE END)
),
prev AS (
  SELECT
    COALESCE(SUM(CASE WHEN m.flow_type = 'IN'  THEN m.jpy_amount END), 0) AS in_jpy,
    COALESCE(SUM(CASE WHEN m.flow_type = 'OUT' THEN m.jpy_amount END), 0) AS out_jpy
  FROM app.manual_entry m
  LEFT JOIN app.manual_entry_category c ON c.id = m.category_id
  , params p
  WHERE date_trunc('month', m.trade_date) = date_trunc('month', p.m - INTERVAL '1 month')
    AND (p.seg = 'total' OR m.segment = p.seg::app.segment_type)
    AND (p.cur = 'ALL' OR m.currency = p.cur)
    AND (CASE WHEN p.ex THEN COALESCE(c.category_name,'') <> '資金移動' ELSE TRUE END)
)
SELECT
  curr.in_jpy                                        AS in_jpy,
  curr.out_jpy                                       AS out_jpy,
  (curr.in_jpy - curr.out_jpy)                       AS total_jpy,
  prev.in_jpy                                        AS prev_in_jpy,
  prev.out_jpy                                       AS prev_out_jpy,
  (prev.in_jpy - prev.out_jpy)                       AS prev_total_jpy
FROM curr, prev;
`;

const { rows } = await pool.query(listSql, params);
const { rows: sumRows } = await pool.query(sqlSummary, params);

const s = sumRows[0] || {
  in_jpy: 0, out_jpy: 0, total_jpy: 0,
  prev_in_jpy: 0, prev_out_jpy: 0, prev_total_jpy: 0
};

const summary = {
  in_jpy: Number(s.in_jpy),
  out_jpy: Number(s.out_jpy),
  total_jpy: Number(s.total_jpy ?? (Number(s.in_jpy) - Number(s.out_jpy))),
  prev_total_jpy: Number(s.prev_total_jpy),
  mom_diff_jpy:
    Number(s.total_jpy ?? (Number(s.in_jpy) - Number(s.out_jpy))) - Number(s.prev_total_jpy)
};

return res.json({
  month,
  segment,
  currency,
  exclude_transfer: excludeTransfer,
  rows,
  summary
});

  } catch (err) {
    console.error('GET /api/manual-entry error:', err);
    return res.status(500).json({ error: 'internal' });
  }
});

// --- 起動 ---
app.listen(PORT, () => {
  console.log(`Rates API listening on http://localhost:${PORT}`);
});