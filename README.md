# free-tier-quota-probe

A **quota-limit observability probe** for free-tier serverless databases (Cloudflare D1, Supabase, Neon, Turso). It fills a database to its free-tier storage limit **on your own account**, captures the exact failure form (error code / body / request IDs), runs a post-wall operation-survival probe, and tests how you recover — *for free*.

The point is to measure what the docs don't quite say: **what actually breaks, what still works, and how you get out.**

## Status

| Provider | State | What's here |
|---|---|---|
| **Cloudflare D1** | ✅ **measured** (Workers Free, 2026-07) | full fill → wall → survival probe → recovery, captured in [`results/`](./results) |
| Supabase / Neon / Turso | 🚧 scaffolded | config + `.env.example` wiring; adapters planned, **not yet run** |

This repo is the companion to a write-up of the D1 run. The other three providers are a follow-up.

## What we found (Cloudflare D1, Workers Free, 2026-07, REST /query)

Filling one database with high-entropy rows hit the **per-DB 500 MB wall** (distinct from the 5 GB account limit and the daily read/write limits):

- **Wall — 500 MB (decimal); coarse wall reproduced on a 2nd DB, exact pin n=1.** Bulk fill stalls ~499.9 MB; looping single-row inserts pins the ceiling at `meta.size_after = 499,994,624` (= 500,000,000 − 5,376; `122,069 × 4096` pages), after which the next write returns `HTTP 400 / 7500 / "Exceeded maximum DB size"`. The **coarse** wall reproduced on a second, freshly-created DB (both stopped at the identical `499,884,032`). The redacted logs carry no account IDs and `served_by_colo` is Anycast (not an account signal), so what's verifiable is a second DB; the byte-exact pin is n=1.
- **Not a full read-only lockout — but small writes aren't exempt either.** Reads always pass. After the wall, 24 single-row inserts succeeded, consuming only ~110 KB of headroom before even a 1-row insert was rejected. So writes pass *only while headroom remains* — slack, not a size-class exemption (`results/slack-d1.jsonl`).
- **`CREATE INDEX` roughly doubles storage → it hits the wall on its own.** On a 300 MB control (below the wall), `CREATE INDEX` failed with `7500 "Exceeded maximum DB size"`, *not* memory. Deleting the control to 80 MB and re-indexing showed why: `size_after` went `84,029,440 → 167,923,712` — **×1.998, measured once** — because the index copies the blob column's values as keys. So (if that ×2 holds at other sizes) it succeeds at 80 MB (→160 MB), fails at 300 MB (→~600 MB > wall), and OOMs (`SQLITE_NOMEM`) only *at* the wall. Rough rule of thumb, extrapolated (not measured near 250 MB): index ≤ ~250 MB of data per column on Free. (This reverses an earlier "it's just memory" note — measured; `results/index-*-d1.jsonl`.)
- **Recovery R1 — one `DELETE`, no upgrade, but not quota-free.** `DELETE` drops the reported `meta.size_after` (~500→244 MB) *immediately* and writes resume; `VACUUM` is rejected over REST `/query` and isn't needed. But D1 counts `DELETE` as a write, so the 19,998-row recovery spent ≈20% of the daily 100k free write budget. And `size_after` is D1's *reported* size (the docs don't say physical vs logical) — the meter dropping doesn't prove the file shrank (cf. workerd#1618, local).

Caveats: **REST `/query` only** (Worker Binding API may differ, esp. `VACUUM`); the **coarse** wall was reproduced on a second DB, but the exact pin, the index ×2, and the DELETE recovery are each n=1 (one DB/size); the account-storage wall and daily-read wall are not measured; the ~250 MB index threshold is extrapolated, not pinned; `size_after` behaves like a coherent logical meter (dropped on the one DELETE, ~doubled on the one index build) but the docs don't confirm physical vs logical. Raw captures in [`results/`](./results); frozen predictions + follow-up amendment in [`PREREGISTRATION.md`](./PREREGISTRATION.md).

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

Code: MIT (see `LICENSE`). Data, tables and figures (`results/*.jsonl`, figures): CC BY 4.0 (see `DATA_LICENSE`) — please credit **Sumitsuke Lab** (https://sumitsuke.jp/lab/). Educational / interoperability use.

## 設計・検証の記録（Sumitsuke Lab）

このリポジトリの背景・検証環境・判定・最終検証日・失敗例は、Sumitsuke Lab の本家記事にまとめています。

- 無料枠の実測シリーズ（D1 500MB の壁ほか） → https://sumitsuke.jp/lab/
- 受託（生成 AI コード・外注コードの点検と修理・テキスト完結） → https://sumitsuke.jp/works/repair/
