# 資産管理システム｜運用Runbook（API/DB/トンネル）

## 1. 接続（本番想定）
- SSMターゲット：**i-010d88891d319fa74 (ec2-ams-web-new / asset-apps-vpc 10.1.0.0/16)**
- コマンド：
  aws ssm start-session --region ap-southeast-2 --profile asset-prod \
    --target i-010d88891d319fa74 \
    --document-name AWS-StartPortForwardingSessionToRemoteHost \
    --parameters "host=asset-prod-db.ch2wau2wwo1x.ap-southeast-2.rds.amazonaws.com,portNumber=5432,localPortNumber=15432"

## 2. RDSセキュリティ
- 許可：**PostgreSQL 5432 / Source = 10.1.0.0/16 のみ**
- 一時ルールは作成後に即時削除（旧VPC/固定IPは残さない）

## 3. API起動（ローカル検証）
- DATABASE_URL（assetapp）で起動：
  DATABASE_URL='postgres://assetapp:***@127.0.0.1:15432/assetdb' \
  NODE_TLS_REJECT_UNAUTHORIZED=0 node rates-api.js

## 4. /api の仕様差分（2025-10-02）
- `/api/rates` は **app.fx_rate_monthly** を参照（コミット **8d9ceae**）
- `/api/manual-entry` は `flow_type` を `type` エイリアスで返却、`category_name` は left join

## 5. データ運用
- 2025-07 `IN` の `category_id` を **2: その他収益** に一括補完
  BEGIN;
  UPDATE app.manual_entry
    SET category_id = 2
    WHERE flow_type='IN' AND category_id IS NULL
      AND to_char(trade_date,'YYYY-MM')='2025-07';
  COMMIT;

## 6. ダッシュボード検証例
- /api/dashboard/summary?month=2025-07&view=total&mode=avg
  → now = 855,426,052,745.0835
- /api/dashboard/monthly?year=2025&view=total&mode=avg
  → 7月のみピーク

## 7. 変更履歴
- 2025-10-02: 新VPC(10.1.0.0/16) ⇔ RDS(10.0.0.0/16) ピアリング、RDS SG最小化、API修正

■ 月末レートの自動補完仕様（Fixer）
- Sync が失敗した月（未来月など）は「前月の月末レート」を自動採用。
- 手入力/CSV/ダッシュボードの全ロジックがこのレートキャッシュを参照する。

# 月末レート同期（例：2025年11月）
curl -sS -X POST "http://127.0.0.1:3001/admin/rates/sync?month=2025-11" | jq

## 8. 修正作業の標準フロー（必ず遵守）
1. 修正前に必ず **docs/修正ルール20251125v2.txt** と **この Runbook** を確認する  
2. 影響範囲（API / DB / フロント / CSV）をメモしてから修正を開始する  
3. 修正後は、最低限「対象月2つ以上」で動作確認（/admin/rates/sync, ダッシュボード等）を行う  
4. 問題なければ **docs/修正ルール20251125v2.txt の「変更履歴」に1行追記** する  
5. `git status` を確認のうえ `git commit` → `git push`（ブランチは基本 `release/v2.2`）