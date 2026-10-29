-- printedrobotics.cz analytics: raw event table in ClickHouse Cloud (EU region).
-- Written by backend/api (ClickHouseSink, HTTP insert, FORMAT JSONEachRow) once CLICKHOUSE_URL / _USER /
-- _PASSWORD are set. Columns mirror EventRecord in backend/api/src/analytics/validate.ts; props holds only the
-- allow-listed properties of analytics/schema.json (values as strings). No IPs, no user agents, no free text.
--
-- Setup (once, as an admin in the SQL console):
--   1. run this file
--   2. create the ingest user with INSERT only (password is a secret: never commit it):
--        CREATE USER pr_ingest IDENTIFIED WITH sha256_password BY '<generated>' SETTINGS async_insert = 1;
--        GRANT INSERT ON analytics.events TO pr_ingest;
--   3. add CLICKHOUSE_URL / CLICKHOUSE_USER / CLICKHOUSE_PASSWORD as GitHub secrets (docs/analytics/events.md)

CREATE DATABASE IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.events
(
    received_at     DateTime64(3, 'UTC')                CODEC(Delta, ZSTD(1)),
    event_time      DateTime64(3, 'UTC')                CODEC(Delta, ZSTD(1)),
    event           LowCardinality(String),
    anon_id         UUID,
    session_id      UInt64,
    seq             UInt32,
    insert_id       FixedString(32),
    path            LowCardinality(String),
    lang            LowCardinality(String),
    country         LowCardinality(String),
    device          LowCardinality(String),
    schema_version  UInt16,
    props           Map(LowCardinality(String), String)
)
ENGINE = ReplacingMergeTree(received_at)          -- retried inserts collapse on insert_id
PARTITION BY toYYYYMM(event_time)
ORDER BY (event, toDate(event_time), anon_id, insert_id)
TTL toDateTime(event_time) + INTERVAL 25 MONTH DELETE
SETTINGS index_granularity = 8192;

-- Weekly North Star: users (anonymous ids) with at least one unassisted mission win.
-- SELECT toStartOfWeek(event_time, 1) AS week, uniqExact(anon_id) AS users
-- FROM analytics.events FINAL
-- WHERE event = 'mission_win' AND props['assisted'] = 'false'
-- GROUP BY week ORDER BY week;

-- Backfill from the interim NDJSON files (/data/events/events-YYYY-MM-DD.ndjson on the api volume):
-- convert each line with the same mapping as ClickHouseSink.toRow, or insert via clickhouse-client:
--   jq -c '{received_at:(.received_at/1000|strftime("%Y-%m-%d %H:%M:%S")), event_time:(.time/1000|strftime("%Y-%m-%d %H:%M:%S")),
--           event, anon_id, session_id, seq, insert_id, path, lang, country, device, schema_version,
--           props:(.props|map_values(tostring))}' events-*.ndjson \
--   | clickhouse-client --query 'INSERT INTO analytics.events FORMAT JSONEachRow'
