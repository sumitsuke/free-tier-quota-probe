# Pre-registration — Free-tier serverless DB "at the wall" probe

**Frozen at commit time (this file's git hash is the pre-registration anchor). Measured results must be reported against these predictions; any change after measurement is an amendment recorded in git history, not an edit.**

- Providers (own free-tier accounts, throwaway projects): **Supabase / Neon / Turso / Cloudflare D1**
- Confirm-date of all doc facts below: **2026-07-08** (re-verify at publish — pre-publish currency review is mandatory)
- Design lineage: internal design doc, v7 (not distributed with this public repo). This file operationalizes its §1–§5.

## Backbone (measured artifacts — durable to vendors fixing docs)
1. **failure-form catalog** — captured SQLSTATE / error body / request IDs at each wall.
2. **recovery-class matrix** — R0–R5 executed per provider recipe (mechanism confirmed by measurement).
3. **reachability map** — read-blocking walls exist on all 4, but D1's is *daily-scoped* = the only one reachable in a short run and the one free-tier operators most realistically hit.

Doc-vs-reality contradictions are **supporting color only** (verify at publish). We do **not** headline them.

## Claim table × wall type (predicted; the DIFF vs measured is the finding)

| provider | wall | scope | metering | predicted first failure | predicted read after wall | predicted error signature | predicted recovery (class) |
|---|---|---|---|---|---|---|---|
| Supabase | DB size 500 MB | project | database size (not disk) | INSERT/UPDATE/DELETE fail (read-only) | **SELECT continues** | `25006` "cannot execute … in a read-only transaction" | official recipe: `set session … read write` → DELETE → `vacuum` → `default_transaction_read_only=off`; auto re-enable below threshold (**R1/R2**) |
| Neon | storage 0.5 GB | project (root branch) | logical + WAL history (6 h window), hourly meter | storage-increasing ops incl **DELETE** fail | **SELECT continues** IF ops-fail path; **may stop** if suspend path | SQLSTATE `53100` disk_full "could not extend file … size limit … exceeded" (two message variants) — OR connection-level if suspend | **reduce restore/history window → 0** (control-plane), not VACUUM (**R2**). *plain DELETE fails at cap.* |
| Turso | total storage 5 GB | plan/org | rows-read/written/storage monthly | write ops fail `BLOCKED` (Free-applicability = measured) | **measured** (does SELECT also BLOCK?) | `BLOCKED` error code | **VACUUM disabled** ("currently disabled in Turso") → SQL compaction blocked; DELETE doesn't shrink file → **stuck (R4/R5)** |
| D1 | storage 500 MB/DB | DB | storage (rows unlimited, 2 MB/row) | INSERT / CREATE-ALTER TABLE / INDEX / TRIGGER fail | **SELECT continues** | "Exceeded maximum DB size." (per-DB) | delete unused DBs / clean stale data (**R4** likely) |
| **D1 (2nd wall)** | **daily rows-read 5M/day** | **account** | daily, reset 00:00 UTC | **all queries incl SELECT fail** | **NO — reads blocked** | "you will not be able to run queries … daily limits … exceeded" | wait for 00:00 UTC reset (**R3**) — the reachability headline |

**Fallback headline pre-registration (Neon suspend case):** if Neon suspends compute at the storage cap (FAQ path) rather than failing ops (plans/cost-optimization path), the capture is a *connection-level* error and the post-wall probe + content-hash on Neon will themselves fail — that outcome ("Neon goes dark at the wall; you cannot even observe it from SQL") is itself a reported result, not a protocol failure.

**Two-sided:** if all four turn out to "block writes / keep reads" on storage and both recoverable, the result is "the storage wall is boringly uniform — the interesting divergence is the recovery *mechanism* and D1's daily read wall." Still publishable.

## Wall-ordering is an OUTCOME, not a precondition
Row size is **not** frozen. We freeze the **calibration procedure + adaptive stop rule** (`config.mjs` SAMPLING + calibrate.mjs). Which wall fires first at a given row size is a *reported finding* (e.g. "write-wall precedes storage-wall below R bytes/row"). Turso needs ≥ ~1 KB/row and **INTEGER PRIMARY KEY only, no secondary index** (an index doubles rows-written → write-wall precedes storage-wall). D1 storage needs ~8–16 KiB/row (2 MB/row cap). If projected Turso 5 GB fill > 3 h wall-clock, **demote Turso storage to bounded-run + extrapolation (n=1)**.

## Near-wall stopping = ERROR-driven (not meter-driven)
Meters lag (Neon hourly). Coarse fill is meter-driven; near the wall, insert the smallest fixed increment and stop on the **actual enforcement error** (ground truth, lag-free). Record `native_size` AND provider meter AND the error, at error time.

## Post-wall probe battery (control-interleaved, disjoint targets)
For each mutating probe, run the identical op against a **non-walled control sibling on the same provider/code path** at the same time; a failure is wall-attributable only if control succeeds. Capture a **baseline battery under the limit first**; score post-wall as a DIFF. Order (least→most mutating), meter-bracketed:
`P7 meter → P1 SELECT(sentinel) → P6 new-connection SELECT → P2a tiny INSERT(fixed bytes) → P3 UPDATE row-U → P4a DELETE row-D → P4b provider-recovery-recipe then INSERT (→ R1?) → P5a CREATE TABLE(empty=DDL) → P5b CREATE INDEX(space) → P7 meter`.
Tag each run with **wall type** (storage vs write-count vs daily-read). On Postgres, UPDATE/DELETE failing at a storage wall is MVCC+WAL, not "op forbidden" — state the mechanism. `control-sibling` note: on **account/daily-scoped walls (D1 daily, Turso monthly), the control ALSO fails — that is the result (canary)**, not a bug.

## D1 execution order (freeze)
`fill storage → storage probe → storage recovery → content-hash → control → **daily read wall LAST** → minimal post-read-wall probe (does WRITE still work? separate meter) → any further D1 work after 00:00 UTC reset`.
D1 daily-read wall = separate small table, small-payload aggregate (`SELECT SUM(k)` / unindexed scan), **`meta.rows_read`-driven adaptive stop** (`5_000_000 − cumulative`), never `SELECT *` big payload.

## Integrity (content-hash, client-side streaming)
"Data survived" = **full-table order-independent content hash match** (`SELECT k,v ORDER BY k` streamed, client-side SHA-256 incremental) + row count + `PRAGMA integrity_check` (SQLite) / catalog diff (PG) + atomicity of last failed write. Checkpoints: **fill前 / 壁直後 / 復旧直後** (Core). 24h / pause / archive = Long-tail (cited, not measured in Core). Server-side `md5(string_agg)` is **not** used (memory/ordering at 500 MB). Checksum scans consume egress (Supabase/Neon) / rows_read (D1/Turso) → logged to the quota ledger.

## Provenance (allowlist capture)
Capture only: HTTP status, selected headers (rate-limit / `Retry-After` / `CF-Ray` / request-id), error code, error body, timestamp (wall-clock + monotonic), operation type, meter values. Raw full responses (may contain secrets) stay in a private, git-ignored file; the published JSONL is the allowlisted redacted set. This is **auditability**, not re-runnability (one-shot walls are un-replicated; disclosed as n=1).

## ToS / AUP (Phase 0, before running)
Own accounts only; throwaway projects; **no multi-account**; app-realistic rate (no retry-storm; stop on 429); we **fill** allotted caps, we do not **exceed** them (retain evidence). Read each provider AUP and set identity strategy consciously (public GitHub/Qiita identity). Kill on: 429 storm / 5xx run / abuse notice / anomalous queue time.

## Quote-freeze (cite only these strings) & don't-write list
See the internal design doc §5 (not distributed with this public repo). Key don't-writes: "D1 storage wall blocks SELECT" (that's the daily wall); "Supabase can't recover via SQL" (official recipe exists); "Neon 90-day deletion is a general policy" (Azure-region only); "Turso VACUUM works" (disabled); "#43487 is a live contradiction" (fixed 2026-04-13); "the D1 $134 bill is a Cloudflare-reported incident" (it's a developer post-mortem); "storage axis is uniform" (measure first).

## Facts pending measurement / re-verify at publish
Neon suspend-vs-fail at cap; Turso `BLOCKED` on Free + whether SELECT also blocks; Supabase actual read-only trigger (500 MB db / 1.5× one-shot growth / disk %); D1 read-replication still Beta; Turso platform (SDK `@tursodatabase/serverless` now recommended) + free-tier survival.
