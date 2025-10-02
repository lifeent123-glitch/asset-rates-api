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
  DATABASE_URL='postgresql://assetapp:***@127.0.0.1:15432/assetdb' \
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
