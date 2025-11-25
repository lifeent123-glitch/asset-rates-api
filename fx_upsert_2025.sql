BEGIN;
/* 2025-01 USD avg(JPY/1USD)=156.4075660299997 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('USD', '2025-01-01', 156.4075660299997, 156.4075660299997, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-01 EUR avg(JPY/1EUR)=161.9789524301009 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('EUR', '2025-01-01', 161.9789524301009, 161.9789524301009, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-01 GBP avg(JPY/1GBP)=193.15362794581 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('GBP', '2025-01-01', 193.15362794581, 193.15362794581, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
-- WARN: http error for EGP 2025-01
-- WARN: http error for AED 2025-01
-- WARN: http error for TWD 2025-01
/* 2025-01 IDR avg(JPY/1IDR)=0.009623132824986669 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('IDR', '2025-01-01', 0.009623132824986669, 0.009623132824986669, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-02 USD avg(JPY/1USD)=151.9732866786718 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('USD', '2025-02-01', 151.9732866786718, 151.9732866786718, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-02 EUR avg(JPY/1EUR)=158.22704199460955 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('EUR', '2025-02-01', 158.22704199460955, 158.22704199460955, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-02 GBP avg(JPY/1GBP)=190.43407752525127 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('GBP', '2025-02-01', 190.43407752525127, 190.43407752525127, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
-- WARN: http error for EGP 2025-02
-- WARN: http error for AED 2025-02
-- WARN: http error for TWD 2025-02
/* 2025-02 IDR avg(JPY/1IDR)=0.009298782889912196 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('IDR', '2025-02-01', 0.009298782889912196, 0.009298782889912196, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-03 USD avg(JPY/1USD)=149.21205406072306 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('USD', '2025-03-01', 149.21205406072306, 149.21205406072306, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-03 EUR avg(JPY/1EUR)=160.95830481765344 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('EUR', '2025-03-01', 160.95830481765344, 160.95830481765344, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-03 GBP avg(JPY/1GBP)=192.4227645303037 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('GBP', '2025-03-01', 192.4227645303037, 192.4227645303037, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
-- WARN: http error for EGP 2025-03
-- WARN: http error for AED 2025-03
-- WARN: http error for TWD 2025-03
/* 2025-03 IDR avg(JPY/1IDR)=0.009056887669981006 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('IDR', '2025-03-01', 0.009056887669981006, 0.009056887669981006, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-04 USD avg(JPY/1USD)=144.19173225042192 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('USD', '2025-04-01', 144.19173225042192, 144.19173225042192, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-04 EUR avg(JPY/1EUR)=161.6602528044274 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('EUR', '2025-04-01', 161.6602528044274, 161.6602528044274, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-04 GBP avg(JPY/1GBP)=189.34503635358385 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('GBP', '2025-04-01', 189.34503635358385, 189.34503635358385, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
-- WARN: http error for EGP 2025-04
-- WARN: http error for AED 2025-04
-- WARN: http error for TWD 2025-04
/* 2025-04 IDR avg(JPY/1IDR)=0.0085695873605178 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('IDR', '2025-04-01', 0.0085695873605178, 0.0085695873605178, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-05 USD avg(JPY/1USD)=144.5904397126408 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('USD', '2025-05-01', 144.5904397126408, 144.5904397126408, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-05 EUR avg(JPY/1EUR)=163.1001565430821 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('EUR', '2025-05-01', 163.1001565430821, 163.1001565430821, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-05 GBP avg(JPY/1GBP)=193.2642354762933 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('GBP', '2025-05-01', 193.2642354762933, 193.2642354762933, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
-- WARN: http error for EGP 2025-05
-- WARN: http error for AED 2025-05
-- WARN: http error for TWD 2025-05
/* 2025-05 IDR avg(JPY/1IDR)=0.008796844599666133 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('IDR', '2025-05-01', 0.008796844599666133, 0.008796844599666133, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-06 USD avg(JPY/1USD)=144.53496483800538 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('USD', '2025-06-01', 144.53496483800538, 144.53496483800538, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-06 EUR avg(JPY/1EUR)=166.36651948505957 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('EUR', '2025-06-01', 166.36651948505957, 166.36651948505957, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-06 GBP avg(JPY/1GBP)=195.86310246768417 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('GBP', '2025-06-01', 195.86310246768417, 195.86310246768417, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
-- WARN: http error for EGP 2025-06
-- WARN: http error for AED 2025-06
-- WARN: http error for TWD 2025-06
/* 2025-06 IDR avg(JPY/1IDR)=0.008865355471929124 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('IDR', '2025-06-01', 0.008865355471929124, 0.008865355471929124, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-07 USD avg(JPY/1USD)=146.9016242582434 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('USD', '2025-07-01', 146.9016242582434, 146.9016242582434, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-07 EUR avg(JPY/1EUR)=171.52188150028928 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('EUR', '2025-07-01', 171.52188150028928, 171.52188150028928, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-07 GBP avg(JPY/1GBP)=198.34794728840885 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('GBP', '2025-07-01', 198.34794728840885, 198.34794728840885, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
-- WARN: http error for EGP 2025-07
-- WARN: http error for AED 2025-07
-- WARN: http error for TWD 2025-07
/* 2025-07 IDR avg(JPY/1IDR)=0.00901404421662155 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('IDR', '2025-07-01', 0.00901404421662155, 0.00901404421662155, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-08 USD avg(JPY/1USD)=147.6831454072861 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('USD', '2025-08-01', 147.6831454072861, 147.6831454072861, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-08 EUR avg(JPY/1EUR)=171.79554888626603 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('EUR', '2025-08-01', 171.79554888626603, 171.79554888626603, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-08 GBP avg(JPY/1GBP)=198.5512981529202 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('GBP', '2025-08-01', 198.5512981529202, 198.5512981529202, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
-- WARN: http error for EGP 2025-08
-- WARN: http error for AED 2025-08
-- WARN: http error for TWD 2025-08
/* 2025-08 IDR avg(JPY/1IDR)=0.009057030741971854 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('IDR', '2025-08-01', 0.009057030741971854, 0.009057030741971854, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-09 USD avg(JPY/1USD)=147.93252811361867 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('USD', '2025-09-01', 147.93252811361867, 147.93252811361867, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-09 EUR avg(JPY/1EUR)=173.5594016605937 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('EUR', '2025-09-01', 173.5594016605937, 173.5594016605937, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-09 GBP avg(JPY/1GBP)=199.72919371862392 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('GBP', '2025-09-01', 199.72919371862392, 199.72919371862392, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
-- WARN: http error for EGP 2025-09
-- WARN: http error for AED 2025-09
-- WARN: http error for TWD 2025-09
/* 2025-09 IDR avg(JPY/1IDR)=0.008946317772391613 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('IDR', '2025-09-01', 0.008946317772391613, 0.008946317772391613, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-10 USD avg(JPY/1USD)=151.45134972772073 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('USD', '2025-10-01', 151.45134972772073, 151.45134972772073, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-10 EUR avg(JPY/1EUR)=176.15201541230596 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('EUR', '2025-10-01', 176.15201541230596, 176.15201541230596, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
/* 2025-10 GBP avg(JPY/1GBP)=202.14365477627993 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('GBP', '2025-10-01', 202.14365477627993, 202.14365477627993, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
-- WARN: http error for EGP 2025-10
-- WARN: http error for AED 2025-10
-- WARN: http error for TWD 2025-10
/* 2025-10 IDR avg(JPY/1IDR)=0.009122372082617182 (frankfurter) */
INSERT INTO app.fx_rate_monthly (currency, month_start, rate_month_avg, rate_ttm, source)
VALUES ('IDR', '2025-10-01', 0.009122372082617182, 0.009122372082617182, 'frankfurter')
ON CONFLICT (currency, month_start)
DO UPDATE SET
  rate_month_avg = EXCLUDED.rate_month_avg,
  rate_ttm       = EXCLUDED.rate_ttm,
  source         = EXCLUDED.source;
COMMIT;
