# Amplitude: charts, cohorts and the North Star

Project: **default**, EU data center. Events arrive only through our api (server-side forwarding,
`backend/api/src/analytics/sinks.ts`), so every event has `device_id` = the anonymous id, a
`session_id`, `platform = Web`, `language`, `country` when known, and the event properties from
[events.md](events.md) plus `path` and `device`. There is no `user_id`: count **unique users =
unique devices** (one browser after consent).

Create the charts below once data flows (Amplitude connector or UI). Names are suggestions; keep the
`PR · ` prefix so they sort together.

## Dashboard "PR · Funnel"

### 1. PR · Main funnel (Funnel Analysis)

| Step | Event | Filter |
|---|---|---|
| 1. Visit | `page_view` | – |
| 2. Sim loaded | `sim_loaded` | `sim` = `so101` |
| 3. First win | `mission_win` | `assisted` = false |
| 4. AI paired | `ai_paired` | – |
| 5. Waitlist | `waitlist_submit` | – |

- Counting: **unique users**, order **this order**, conversion window **7 days**.
- Breakdowns to save as variants: `language`, `device` (event property), `ref_domain` of step 1,
  `utm_campaign` of step 1.
- Second variant "same session": conversion window = session (shows the one-visit path).

### 2. PR · Sim activation (Funnel)

`page_view` (path = `/sim/so101/`) → `sim_load_start` → `sim_loaded` → `mission_start` →
`mission_win` (`assisted` = false). Window 1 hour. Shows load drop-off (slow networks, no WebGL) and
first-mission drop-off.

### 3. PR · Load health (Segmentation)

- `sim_loaded` and `sim_load_failed`, uniques, daily, grouped by `sim`.
- `sim_load_failed` grouped by `reason`.
- `sim_loaded` property `ms`: **distribution** (or 50th / 90th percentile of `ms`) by `device`.

### 4. PR · Missions (Segmentation)

- `mission_win` totals grouped by `mission`, split `assisted` true / false.
- `hint_used` and `solution_shown` grouped by `mission` (where people get stuck).
- `mission_start` → `mission_win` funnel grouped by `mission` (per-mission completion rate).

### 5. PR · AI (Funnel + Segmentation)

- Funnel: `ai_panel_open` → `ai_paired` → `ai_tool_call` (window 1 hour).
- `ai_tool_call` grouped by `tool` (sampled: first call per tool per page view, so read it as
  "sessions that used the tool", not as call volume).

### 6. PR · Arena (Segmentation)

- `arena_match_start` uniques daily; grouped by `mode`, by `robot`.
- `arena_match_end` grouped by `result` and `kind`.
- `replay_shared` grouped by `method`.

### 7. PR · Leads (Segmentation)

- `waitlist_submit` grouped by `interest`, `school_lead_submit`, daily totals.
- `cta_click` grouped by `id` (which buttons lead people on).
- `kit_view` grouped by `kit`.

### 8. PR · Acquisition (Segmentation)

`page_view` uniques grouped by `ref_domain`, `utm_source`, `utm_campaign`, `country`.

## Cohorts

| Cohort | Definition |
|---|---|
| PR · Sim players | performed `sim_loaded` (`sim` = `so101`) ≥ 1 in the last 30 days |
| PR · Mission winners | performed `mission_win` with `assisted` = false ≥ 1 in the last 30 days |
| PR · Stuck players | performed `mission_start` ≥ 1 and did **not** perform `mission_win` (`assisted` = false) in the last 30 days |
| PR · Hint users | performed `hint_used` ≥ 1 in the last 30 days |
| PR · AI pairers | performed `ai_paired` ≥ 1 in the last 30 days |
| PR · Arena fighters | performed `arena_match_end` ≥ 1 in the last 30 days |
| PR · Leads | performed `waitlist_submit` or `school_lead_submit` ≥ 1 ever |
| PR · Teachers (proxy) | viewed `page_view` with path starting `/pro-skoly/` or `/en/for-schools/` ≥ 1 in the last 30 days |

Use them as segments in the funnels (e.g. funnel 1 for "AI pairers" vs everyone) and for retention.

## North Star

**Weekly users with at least one mission win** = unique devices per ISO week that performed
`mission_win` with `assisted` = false.

- Chart: Segmentation, event `mission_win`, filter `assisted` = false, measure **uniques**,
  interval **weekly**, last 26 weeks. Name: `PR · North Star: weekly winners`.
- Inputs to watch next to it: weekly uniques of `sim_loaded` (reach), conversion step 2 → 3 of the
  main funnel (activation), `PR · Retention` below (habit).
- Same number from raw data (ClickHouse, once running): see the query at the end of
  `analytics/clickhouse.sql`.

## Retention

`PR · Retention`: Retention Analysis, start event `mission_win` (`assisted` = false), return event
`mission_start` or `arena_match_start`, weekly buckets, 8 weeks.

## Notes

- All numbers cover only visitors who allowed analytics; the consent rate itself cannot be measured
  (a decline sends nothing). Compare trends, not absolute visitor counts.
- The tracking plan in Amplitude (Data → Events) should mark exactly the events of
  `analytics/schema.json` as planned; anything else showing up is a bug.
