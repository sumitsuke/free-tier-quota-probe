# free-tier-quota-probe

A **quota-limit observability probe** for free-tier serverless databases (Supabase, Neon, Turso, Cloudflare D1). It fills a database to its documented free-tier storage limit **on your own account**, captures the exact failure form (SQLSTATE / error body / request IDs), runs a post-wall operation-survival probe, executes each provider's documented recovery recipe, and verifies data integrity with a content hash.

The point is to measure what the docs don't say: *what actually breaks, what still works, and how you get out — for free.*

## Responsible use (read before running)

This is **not** an abuse or load-testing tool. It is designed for measuring, on **your own** free-tier resources:

- **Own accounts only.** No multi-account. No creating accounts programmatically. No credential rotation to evade limits.
- **Fill, don't exceed.** We consume the *allotted* free quota (which is the documented, expected behavior) and stop at the first hard wall. We keep evidence that we never went over.
- **App-realistic rate.** No retry-storms. Stops on `429`. Rate-limited to plausible application traffic.
- **No billing.** Run only with no card registered / spend cap ON / overages OFF. The scripts refuse to run unless you assert `BILLING_SAFE=confirmed`, and default to **dry-run**.
- **Read each provider's AUP first** and decide your identity strategy consciously.

If you fork this, keep it that way. Any code that creates accounts, rotates keys, or circumvents limits is explicitly out of scope.

## What it does

| script | purpose |
|---|---|
| `npm run selftest` | offline checks (generator determinism, config sanity) — no credentials needed |
| `npm run calibrate -- --target <t>` | insert K rows; measure bytes/row (native size vs provider meter) to plan the fill |
| `npm run fill -- --target <t>` | coarse→fine fill to the storage wall; error-driven stop; capture the wall |
| `npm run probe -- --target <t>` | post-wall operation-survival battery (control-interleaved) |
| `npm run recover -- --target <t>` | run the provider's documented recovery recipe; test SQL-only vs control-plane |
| `npm run checksum -- --target <t>` | client-side streaming content hash + integrity check |

All destructive scripts require `BILLING_SAFE=confirmed` and `--confirm-destructive`, and hard-cap iterations.

## Setup

1. `npm install`
2. Copy `.env.example` → `.env` and fill in credentials for the targets you'll run (see `.env.example` for exactly what each provider needs).
3. `npm run selftest` (no credentials required).
4. Dry-run a target before committing: `npm run fill -- --target d1` (prints the plan, writes nothing).

## Method & predictions

The frozen pre-registration (predictions before measurement) is in [`PREREGISTRATION.md`](./PREREGISTRATION.md). Its git commit is the pre-registration anchor: results are reported as the *diff* between those predictions and what actually happened.

## Provenance

Raw responses (which may contain secrets) are written to a git-ignored private file. The published record is an allowlisted, redacted JSONL. This gives auditability; one-shot walls are disclosed as un-replicated (n=1).

## License

MIT. Educational / interoperability use.
