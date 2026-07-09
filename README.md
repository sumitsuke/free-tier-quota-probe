# free-tier-quota-probe

A **quota-limit observability probe** for free-tier serverless databases (Cloudflare D1, Supabase, Neon, Turso). It fills a database to its free-tier storage limit **on your own account**, captures the exact failure form (error code / body / request IDs), runs a post-wall operation-survival probe, and tests how you recover — *for free*.

The point is to measure what the docs don't quite say: **what actually breaks, what still works, and how you get out.**

## Status

| Provider | State | What's here |
|---|---|---|
| **Cloudflare D1** | ✅ **measured** (Workers Free, 2026-07) | full fill → wall → survival probe → recovery, captured in [`results/`](./results) |
| Supabase / Neon / Turso | 🚧 scaffolded | config + `.env.example` wiring; adapters planned, **not yet run** |

This repo is the companion to a write-up of the D1 run. The other three providers are a follow-up.

## What we found (Cloudflare D1, Workers Free, 2026-07, n=1)

Filling one database with high-entropy rows hit the **per-DB 500 MB wall** (not the 5 GB account limit, not the daily read/write limits — those are separate walls):

- **Wall:** at `500,498,432` bytes → `HTTP 400 / code 7500 / "Exceeded maximum DB size"` (39,050 rows, 92 s).
- **The wall is not read-only.** After the wall, `SELECT`, single-row `INSERT/UPDATE/DELETE`, and `CREATE TABLE` all still succeed. Only **bulk `INSERT` (50 rows / ~600 KB)** and **`CREATE INDEX`** are blocked — both return code `7500`, but with different messages (`Exceeded maximum DB size` vs `out of memory: SQLITE_NOMEM`). So `7500` is a **generic** D1 query-error code; the storage wall is identified by the *message*, not the code.
- **Recovery is R1 (SQL only, free).** `DELETE` of a chunk drops the reported `meta.size_after` from ~500 MB to ~244 MB *immediately*, and writes resume. `VACUUM` is rejected (`cannot VACUUM from within a transaction`) — and isn't needed.

Caveats: each operation is **n=1**; the operation-size threshold between "passes" and "blocked" is not characterized; whether the per-DB wall and the account 5 GB wall share enforcement is **untested**. Raw captures are in [`results/`](./results); frozen predictions in [`PREREGISTRATION.md`](./PREREGISTRATION.md).

## Responsible use (read before running)

This is **not** an abuse or load-testing tool. It is for measuring, on **your own** free-tier resources:

- **Own accounts only.** No multi-account. No creating accounts programmatically. No credential rotation to evade limits.
- **Fill, don't exceed.** We consume the *allotted* free quota (documented, expected behavior) and stop at the first hard wall. We keep evidence we never went over.
- **App-realistic rate.** No retry-storms. Stops on `429`. Rate-limited to plausible application traffic.
- **No billing.** Run only with **no card registered / spend cap ON / overages OFF**. The destructive scripts refuse to run unless you assert `BILLING_SAFE=confirmed`, and default to **dry-run**. (If your plan *can* be billed, don't run this — verify the plan is block-on-limit first.)
- **Read each provider's AUP first** and set your identity strategy consciously.

If you fork this, keep it that way. Any code that creates accounts, rotates keys, or circumvents limits is explicitly out of scope.

## Scripts

| script | purpose |
|---|---|
| `npm run selftest` | offline checks (generator determinism, config sanity) — no credentials |
| `npm run ping -- --target d1` | connectivity (`SELECT 1`) |
| `npm run fill -- --target d1 --confirm-destructive` | coarse→fine fill to the storage wall; **error-driven** stop; capture the wall |
| `npm run probe -- --target d1` | post-wall operation-survival battery |
| `npm run recover -- --target d1` | DELETE → re-insert → VACUUM: which recovery class? |

Destructive scripts require `BILLING_SAFE=confirmed` **and** `--confirm-destructive`, and hard-cap iterations. `calibrate` (bytes/row planning) and `checksum` (client-side streaming content hash) are designed in `PREREGISTRATION.md` but **not yet implemented**.

## Setup

1. `npm install`
2. Copy `.env.example` → `.env` and fill in credentials for the target you'll run (see `.env.example` for exactly what each provider needs). **Never commit `.env`.**
3. `npm run selftest` (no credentials required).
4. Dry-run first: `npm run fill -- --target d1` (prints the plan, writes nothing).

## Method & predictions

The frozen pre-registration (predictions made *before* measurement) is in [`PREREGISTRATION.md`](./PREREGISTRATION.md); its git commit is the anchor. Results are reported as the **diff** between those predictions and what actually happened.

## Provenance

Raw responses (which may contain secrets) are written to a git-ignored private file (`results/raw/`). The published record is an **allowlisted, redacted** JSONL (`results/*.jsonl`): status, code, error body, `CF-Ray`/request-id, timestamp, operation, meter values only. This gives auditability, not re-runnability — one-shot walls are disclosed as un-replicated (n=1).

## License

MIT. Educational / interoperability use.
