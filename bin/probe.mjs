// probe.mjs — post-wall operation-survival battery. Run AFTER a wall is hit (bench already filled).
// Captures which ops survive vs get blocked, with the exact error form. `node --env-file=.env bin/probe.mjs --target d1`
import { makeTarget } from '../lib/targets.mjs';
import { record, appendJsonl } from '../lib/capture.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const name = arg('--target');
if (!name) { console.error('--target required'); process.exit(1); }

const t = makeTarget(name);
const P = (n) => (t.dialect === 'pg' ? `$${n}` : '?'); // placeholder per dialect
const results = [];

const probe = async (label, sql, params = []) => {
  const r = await t.run({ sql, params });
  results.push(record(name, label, r, { sizeAfter: r.meta?.size_after ?? null }));
  console.log(`${r.ok ? 'OK ' : 'BLK'} ${label} ${r.ok ? '' : (r.code || '') + ' ' + (r.message || '').slice(0, 140)}`);
  return r;
};

await t.open();
// least-mutating → most. Uses distinct existing rows so probes don't collide.
await probe('P1_select_read', 'SELECT count(*) AS n FROM bench');
await probe('P2_insert', `INSERT INTO bench(k, v) VALUES (${P(1)}, ${P(2)})`, [990000001, 'x']);
await probe('P3_update', `UPDATE bench SET v = ${P(1)} WHERE k = 1`, ['y']);
await probe('P4a_delete', 'DELETE FROM bench WHERE k = 3'); // does DELETE work at a storage wall? (D1 says "clean up stale data")
await probe('P5a_ddl_create_table', 'CREATE TABLE IF NOT EXISTS probe_ddl (a INTEGER)');
await probe('P5b_ddl_create_index', 'CREATE INDEX IF NOT EXISTS idx_probe_v ON bench(v)');
await t.close(); await t.open(); // P6: fresh connection
await probe('P6_newconn_select', 'SELECT count(*) AS n FROM bench');

appendJsonl(`probe-${name}.jsonl`, { ts: new Date().toISOString(), target: name, phase: 'post-wall-probe', results });
console.log(`\n=== operation-survival matrix (${name}) ===`);
for (const r of results) console.log(`  ${r.ok ? 'survives' : 'BLOCKED '}  ${r.op}${r.ok ? '' : '  ' + ((r.code || '') + ' ' + (r.message || '').slice(0, 90))}`);
await t.close();
