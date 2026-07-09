// fill.mjs — fill a target's storage toward its wall; capture the exact failure form. DESTRUCTIVE.
// Dry-run by default. Real fill requires --confirm-destructive AND env BILLING_SAFE=confirmed.
//   node --env-file=.env bin/fill.mjs --target d1                      (dry run: prints the plan)
//   node --env-file=.env bin/fill.mjs --target d1 --confirm-destructive
//   node --env-file=.env bin/fill.mjs --target d1 --control --cap-mb 300 --confirm-destructive   (fill the control sibling to ~300MB)
// For D1 the real DB size comes back in meta.size_after (authoritative); pg/turso fall back to est bytes
// until a native_size poll is added. Storage wall is per-DB (does not touch the account daily budget).
import { makeTarget } from '../lib/targets.mjs';
import { DIALECTS, SEED } from '../config.mjs';
import { payload } from '../lib/generator.mjs';
import { record, appendJsonl, appendRaw } from '../lib/capture.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);

const name = arg('--target');
if (!name) { console.error('--target required (d1|turso|neon|supabase)'); process.exit(1); }
const confirmed = has('--confirm-destructive');
const rowBytes = Number(arg('--row-bytes', name === 'd1' ? 12288 : name === 'turso' ? 2048 : 8192));
const capMB = Number(arg('--cap-mb', 520));           // hard cap: stop even if no wall (safety)
const capBytes = capMB * 1024 * 1024;
const batch = Number(arg('--batch', 50));             // D1 REST: 2 params/row × 50 = 100 = the param cap
const reportEvery = Number(arg('--report', 20));

// deterministic high-entropy payload of ~rowBytes, base64 for a REST/JSON-safe string body.
// (base64 itself is ~25% compressible; size is read from D1's meta.size_after, so payload compressibility isn't load-bearing.)
const mkPayload = (k) => payload(SEED, k, Math.ceil(rowBytes * 3 / 4)).toString('base64');

console.log(`# fill ${name} — storage wall`);
console.log(`  ~${rowBytes}B/row (base64 high-entropy) · batch ${batch} · cap ${capMB}MB · est ~${Math.ceil(capBytes / rowBytes).toLocaleString()} rows`);
console.log(`  stop on: first enforcement error (read-only / BLOCKED / "Exceeded maximum DB size.") OR the ${capMB}MB cap`);
if (!confirmed) {
  console.log('\nDRY RUN — writes nothing. Add --confirm-destructive (with BILLING_SAFE=confirmed) to fill.');
  process.exit(0);
}
if (process.env.BILLING_SAFE !== 'confirmed') {
  console.error('\nREFUSING: set BILLING_SAFE=confirmed only after confirming the plan BLOCKS (does not bill) on overage.');
  process.exit(2);
}

const t = makeTarget(name);
const d = DIALECTS[t.dialect];
const isControl = has('--control');
const outFile = `fill-${name}${isControl ? '-control' : ''}.jsonl`;
const startedIso = new Date().toISOString();
await t.open(isControl);
for (const stmt of d.schema) { const r = await t.run({ sql: stmt, params: [] }); if (!r.ok) console.error('schema warn:', r.code, r.message); }

const ph = (i) => (t.dialect === 'pg' ? `$${i}` : '?');
const insertSql = (n) => `INSERT INTO bench(k, v) VALUES ${Array.from({ length: n }, (_, j) => `(${ph(j * 2 + 1)}, ${ph(j * 2 + 2)})`).join(',')}`;

// continue from the current max key so re-runs don't collide on the PRIMARY KEY
const mk = await t.run({ sql: 'SELECT COALESCE(MAX(k), 0) AS m FROM bench', params: [] });
let k = (mk.ok && mk.rows?.[0]?.m != null ? Number(mk.rows[0].m) : 0) + 1;
let bytes = 0, batches = 0, wall = null, lastMeta = null;
const t0 = Date.now();
try {
  while (bytes < capBytes) {
    const params = [];
    for (let j = 0; j < batch; j++) { params.push(k, mkPayload(k)); k++; }
    const r = await t.run({ sql: insertSql(batch), params });
    batches++;
    lastMeta = r.meta ?? lastMeta;
    if (r.meta?.size_after != null) bytes = r.meta.size_after; else bytes += batch * rowBytes;
    if (!r.ok) { wall = record(name, 'fill-insert', r, { atRowApprox: k, sizeBytes: bytes }); break; }
    if (batches % reportEvery === 0) console.log(`  batch ${batches} | ~${(bytes / 1048576).toFixed(1)}MB | rows~${k} | ${r.ms}ms`);
  }
} catch (e) { wall = { error: String(e).slice(0, 400) }; }

const rec = {
  ts: new Date().toISOString(), target: t.name, phase: 'storage-fill', startedIso,
  rowBytes, batch, batches, rowsApprox: k - 1,
  sizeBytesAtStop: bytes, sizeMB: +(bytes / 1048576).toFixed(2),
  elapsedSec: Math.round((Date.now() - t0) / 1000),
  hitWall: !!(wall && (wall.ok === false || wall.error)),
  wall: wall ?? '(reached cap, no wall)', lastMeta,
};
appendJsonl(outFile, rec);
appendRaw(`fill-${name}${isControl ? '-control' : ''}.raw.jsonl`, rec);
console.log('\n=== FILL RESULT ===');
console.log(JSON.stringify(rec, null, 2));
console.log('\nNext: bin/probe.mjs (post-wall operation survival) → bin/recover.mjs.');
await t.close();
process.exit(0);
