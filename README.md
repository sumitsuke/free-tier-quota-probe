# free-tier-quota-probe

A **quota-limit observability probe** for free-tier serverless databases (Cloudflare D1, Supabase, Neon, Turso). It fills a database to its free-tier storage limit **on your own account**, captures the exact failure form (error code / body / request IDs), runs a post-wall operation-survival probe, and tests how you recover — *for free*.

The point is to measure what the docs don't quite say: **what actually breaks, what still works, and how you get out.**

## Status

| Provider | State | What's here |
|---|---|---|
| **Cloudflare D1** | ✅ **measured** (Workers Free, 2026-07) | full fill → wall → survival probe → recovery, captured in [`results/`](./results) |
| Supabase / Neon / Turso | 🚧 scaffolded | config + `.env.example` wiring; adapters planned, **not yet run** |

This repo is the companion to a write-up of the D1 run. The other three providers are a follow-up.

## What we found (Cloudflare D1, Workers Free, 2026-07, REST /query, n=1)

Filling one database with high-entropy rows hit the **per-DB 500 MB wall** (distinct from the 5 GB account limit and the daily read/write limits):

- **Wall (bracketed, not pinned).** The last *successful* batch left `meta.size_after = 499,884,032` (≈499.9 MB); the next ~600 KB bulk insert was rejected with `HTTP 400 / code 7500 / "Exceeded maximum DB size"`. The failed query returns no size, so the ceiling is bracketed right around the nominal 500 MB, not pinned to a byte.
- **Not a full read-only lockout — but read the size meter.** Near the wall, `SELECT` plus size-neutral/reducing ops (`UPDATE`/`DELETE`, and a 1-byte `INSERT`) all succeeded. But the probe ran at ≈499.88 MB — ~600 KB *below* the ceiling — and every "survivor" was size-neutral or size-reducing (`results/probe-d1.jsonl` shows each op's `size_after`). So "small writes survive the wall" is **headroom-confounded**, not a proven exemption; only a ~600 KB *growing* write was actually rejected.
- **`CREATE INDEX` is not wall evidence.** It failed with `out of memory: SQLITE_NOMEM` — a **memory** limit (the index build sorts in Worker memory), independent of storage; it would likely fail on a smaller DB too. The same numeric `7500` wraps both messages, and the docs classify failures **by message** — `7500` appears nowhere in them.
- **Recovery R1 — one `DELETE`, no upgrade, but not quota-free.** `DELETE` drops the reported `meta.size_after` (~500→244 MB) *immediately* and writes resume; `VACUUM` is rejected over REST `/query` and isn't needed. But D1 counts `DELETE` as a write, so the 19,998-row recovery spent ≈20% of the daily 100k free write budget. And `size_after` is D1's *reported* size (the docs don't say physical vs logical) — the meter dropping doesn't prove the file shrank (cf. workerd#1618, local).

Caveats: each op **n=1**; **REST `/query` only** (Worker Binding API may differ, esp. `VACUUM`); the size threshold for *growing* writes is uncharacterized; per-DB vs account-wall enforcement untested. Raw captures in [`results/`](./results); frozen predictions in [`PREREGISTRATION.md`](./PREREGISTRATION.md).

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
