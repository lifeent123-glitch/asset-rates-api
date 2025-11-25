import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

async function runFix() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('📡 データベースに接続中...');
    const client = await pool.connect();
    console.log('✅ 接続成功！\n');

    // まず、staging スキーマが存在するか確認
    const { rows: schemaCheck } = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name = 'staging'
    `);

    if (schemaCheck.length === 0) {
      console.log('⚠️  staging スキーマが存在しません');
      console.log('管理者に以下のSQLを実行してもらってください：');
      console.log('  CREATE SCHEMA staging;');
      console.log('  GRANT ALL ON SCHEMA staging TO assetapp;\n');
      client.release();
      await pool.end();
      process.exit(1);
    }

    console.log('✅ staging スキーマ確認完了\n');

    // テーブルが存在するか確認
    const { rows: tableCheck } = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'staging' 
        AND table_name = 'csv_import_raw'
    `);

    if (tableCheck.length === 0) {
      console.log('📝 staging.csv_import_raw テーブルを作成中...');
      await client.query(`
        CREATE TABLE staging.csv_import_raw (
          id SERIAL PRIMARY KEY,
          source_file TEXT,
          row_num INT,
          trade_date TEXT,
          account_name TEXT,
          flow_type TEXT,
          category_name TEXT,
          amount NUMERIC,
          currency TEXT,
          rate NUMERIC,
          jpy_amount NUMERIC,
          memo TEXT,
          segment TEXT,
          created TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      console.log('✅ テーブル作成完了\n');
    } else {
      console.log('✅ テーブル存在確認\n');
    }

    // 現在のカラムを確認
    const { rows: currentColumns } = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'staging' 
        AND table_name = 'csv_import_raw'
    `);

    const columnNames = currentColumns.map(r => r.column_name);
    console.log('📋 現在のカラム:', columnNames.join(', '), '\n');

    // category2_name が存在する場合はリネーム
    if (columnNames.includes('category2_name') && !columnNames.includes('category_name')) {
      console.log('📝 category2_name を category_name にリネーム中...');
      await client.query(`
        ALTER TABLE staging.csv_import_raw 
        RENAME COLUMN category2_name TO category_name
      `);
      console.log('✅ リネーム完了\n');
    } else if (!columnNames.includes('category_name')) {
      console.log('📝 category_name カラムを追加中...');
      await client.query(`
        ALTER TABLE staging.csv_import_raw 
        ADD COLUMN category_name TEXT
      `);
      console.log('✅ カラム追加完了\n');
    } else {
      console.log('✅ category_name は既に存在します\n');
    }

    // 古いデータをクリア
    console.log('🔧 古いデータをクリア中...');
    await client.query('TRUNCATE TABLE staging.csv_import_raw');
    console.log('✅ クリア完了\n');

    // 最終確認
    const { rows: finalColumns } = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns
      WHERE table_schema = 'staging' 
        AND table_name = 'csv_import_raw'
      ORDER BY ordinal_position
    `);

    console.log('📋 最終的なテーブル構造:');
    finalColumns.forEach(col => {
      const marker = col.column_name === 'category_name' ? ' ✅' : '';
      console.log(`   ${col.column_name} (${col.data_type})${marker}`);
    });

    client.release();
    await pool.end();

    console.log('\n' + '='.repeat(50));
    console.log('🎉 修正完了！');
    console.log('='.repeat(50));
    console.log('\n次のステップ:');
    console.log('1. APIサーバーを再起動してください');
    console.log('   Ctrl+C → node rates-api.js');
    console.log('2. CSVアップロードをテストしてください\n');

  } catch (error) {
    console.error('\n❌ エラー:', error.message);
    console.error('\n詳細:', error);
    process.exit(1);
  }
}

runFix();
