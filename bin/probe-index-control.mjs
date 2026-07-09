// probe-index-control.mjs — is CREATE INDEX's SQLITE_NOMEM a STORAGE-wall effect or an independent
// MEMORY effect? Run CREATE INDEX on a CONTROL DB filled BELOW the wall (e.g. ~300MB). If it still fails
// out-of-memory well under 500MB, the failure is memory-bound and INDEPENDENT of the storage wall —
// which means it should not have been shown as "wall evidence" in the survival matrix.
//   1) npm run fill -- --target d1 --control --cap-mb 300 --confirm-destructive
//   2) node --env-file=.env bin/probe-index-control.mjs --target d1
import { makeTarget } from '../lib/targets.mjs';
import { record, appendJsonl } from '../lib/capture.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const name = arg('--target');
if (!name) { console.error('--target required'); process.exit(1); }

const t = makeTarget(name);
if (!t.hasControl) { console.error('no control DB configured (set D1_CONTROL_DATABASE_ID / *_CONTROL_URL in .env)'); process.exit(2); }
await t.open(true); // CONTROL sibling — should be filled BELOW the wall

const sz = await t.run({ sql: 'SELECT count(*) AS n FROM bench', params: [] });
const sizeAfter = sz.meta?.size_after ?? null;
const mb = sizeAfter != null ? +(sizeAfter / 1048576).toFixed(1) : null;
console.log(`# probe-index-control ${name} — CREATE INDEX on the control DB at ${mb ?? '?'}MB (should be < 500MB wall)`);
if (sizeAfter != null && sizeAfter > 480 * 1048576) console.log('  ⚠ control is near the 500MB wall — refill it smaller (--cap-mb 300) for a clean, wall-free test.');

await t.run({ sql: 'DROP INDEX IF EXISTS idx_ctrl_v', params: [] }); // idempotent re-run
const r = await t.run({ sql: 'CREATE INDEX idx_ctrl_v ON bench(v)', params: [] });
const rec = record(name, 'ctrl_create_index', r, { sizeBefore: sizeAfter, sizeMB: mb });

const verdict = r.ok
  ? `CREATE INDEX SUCCEEDED at ${mb}MB → the SQLITE_NOMEM seen at the 500MB wall is NOT reproduced here. The memory threshold is between ${mb}MB and ~500MB (index cost tracks DB size), so it's still not the storage wall itself — but re-word the article: at 300MB it builds fine.`
  : /NOMEM|memory/i.test(r.message || '')
    ? `CREATE INDEX FAILED with a memory error at ${mb}MB — well BELOW the 500MB storage wall. CONFIRMED: the index failure is MEMORY-bound and INDEPENDENT of the storage wall (correctly separated from bulk-INSERT in the matrix).`
    : `CREATE INDEX FAILED at ${mb}MB with a non-memory error: ${r.code} ${(r.message || '').slice(0, 140)} → inspect before concluding.`;

appendJsonl(`index-control-${name}.jsonl`, {
  ts: new Date().toISOString(), target: name, phase: 'index-control',
  sizeBefore: sizeAfter, sizeMB: mb, result: rec, verdict,
});
console.log(`\n${r.ok ? 'OK ' : 'BLK'} CREATE INDEX  ${r.ok ? 'size_after=' + (r.meta?.size_after ?? '?') : (r.code || '') + ' ' + (r.message || '').slice(0, 140)}`);
console.log('\n=== VERDICT ===\n' + verdict);
await t.close();
