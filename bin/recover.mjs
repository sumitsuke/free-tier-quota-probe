// recover.mjs — test no-charge recovery from a storage wall (which recovery-class?).
// D1/sqlite: bulk-insert(blocked at wall) → DELETE a chunk → re-try bulk → VACUUM → re-try bulk.
// `node --env-file=.env bin/recover.mjs --target d1`
import { makeTarget } from '../lib/targets.mjs';
import { record, appendJsonl } from '../lib/capture.mjs';
import { payload } from '../lib/generator.mjs';
import { SEED } from '../config.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const name = arg('--target');
if (!name) { console.error('--target required'); process.exit(1); }
const t = makeTarget(name);
const P = (n) => (t.dialect === 'pg' ? `$${n}` : '?');
const steps = [];

let seq = 0;
const bulk = () => {
  const rows = Array.from({ length: 50 }, (_, j) => `(${P(j * 2 + 1)}, ${P(j * 2 + 2)})`).join(',');
  const params = [];
  for (let j = 0; j < 50; j++) { params.push(800000000 + (seq++) * 100 + j, payload(SEED, j, 9000).toString('base64')); }
  return { sql: `INSERT INTO bench(k, v) VALUES ${rows}`, params };
};
const log = (label, r, extra = {}) => {
  steps.push(record(name, label, r, { size: r.meta?.size_after ?? null, ...extra }));
  console.log(`${r.ok ? 'OK ' : 'BLK'} ${label}  ${r.ok ? 'size=' + (r.meta?.size_after ?? '?') + ' changes=' + (r.meta?.changes ?? '?') : (r.code || '') + ' ' + (r.message || '').slice(0, 110)}`);
};
const size = async () => { const r = await t.run({ sql: 'SELECT count(*) AS n FROM bench', params: [] }); return { n: r.rows?.[0]?.n, sizeAfter: r.meta?.size_after }; };

await t.open();
log('R0_bulk_insert_at_wall', await t.run(bulk()));                                  // expect BLOCKED (still at wall)
log('R1_delete_chunk', await t.run({ sql: 'DELETE FROM bench WHERE k < 20000', params: [] })); // free logical space
const s1 = await size(); console.log(`  after DELETE: rows=${s1.n} size_after=${s1.sizeAfter}`);
log('R1_bulk_after_delete', await t.run(bulk()));                                    // did DELETE alone recover?
log('R2_vacuum', await t.run({ sql: 'VACUUM', params: [] }));                        // does D1 support VACUUM? does it shrink?
const s2 = await size(); console.log(`  after VACUUM: rows=${s2.n} size_after=${s2.sizeAfter}`);
log('R2_bulk_after_vacuum', await t.run(bulk()));                                    // recovered after VACUUM?

appendJsonl(`recover-${name}.jsonl`, { ts: new Date().toISOString(), target: name, phase: 'recover', steps });
console.log(`\n=== recovery path (${name}) ===`);
for (const s of steps) console.log(`  ${s.ok ? 'OK ' : 'BLK'} ${s.op}${s.ok ? '' : '  ' + ((s.code || '') + ' ' + (s.message || '').slice(0, 80))}`);
await t.close();
