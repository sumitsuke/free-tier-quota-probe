// probe-slack.mjs — "slack vs exemption": at the per-DB storage wall, loop SINGLE-ROW inserts of a
// fixed small payload and count how many land before it trips. This both (a) pins the ceiling to one
// row and (b) tells whether small writes are genuinely exempt from the cap or just consuming headroom.
// A pure storage cap cannot exempt writes forever, so the expected result is SLACK; measuring it removes
// the n=1 ambiguity in the survival matrix. Run AFTER fill.mjs has hit the wall on --target.
//   node --env-file=.env bin/probe-slack.mjs --target d1
import { makeTarget } from '../lib/targets.mjs';
import { record, appendJsonl } from '../lib/capture.mjs';
import { payload } from '../lib/generator.mjs';
import { SEED } from '../config.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);
const name = arg('--target');
if (!name) { console.error('--target required'); process.exit(1); }
const useControl = has('--control');
const rowBytes = Number(arg('--row-bytes', 4096));   // fixed small payload → fine resolution of the ceiling
const maxIters = Number(arg('--max', 2000));         // backstop: 2000×4KB ≈ 8MB ≫ the ~600KB headroom

const t = makeTarget(name);
const P = (n) => (t.dialect === 'pg' ? `$${n}` : '?');
const mkPayload = (k) => payload(SEED, k, Math.ceil(rowBytes * 3 / 4)).toString('base64');
await t.open(useControl);

// continue from MAX(k)+1 so single-row inserts never collide on the PRIMARY KEY
const mk = await t.run({ sql: 'SELECT COALESCE(MAX(k),0) AS m FROM bench', params: [] });
let k = (mk.ok && mk.rows?.[0]?.m != null ? Number(mk.rows[0].m) : 0) + 1;
const start = await t.run({ sql: 'SELECT count(*) AS n FROM bench', params: [] });
const startSize = start.meta?.size_after ?? null;
console.log(`# probe-slack ${name}${useControl ? ' (control)' : ''} — single-row INSERT loop at the wall`);
console.log(`  fixed ~${rowBytes}B/row · start size_after=${startSize} · backstop ${maxIters} iters (~${(maxIters * rowBytes / 1048576).toFixed(1)}MB ≫ headroom)`);

let ok = 0, wall = null, lastSize = startSize;
for (let i = 0; i < maxIters; i++) {
  const r = await t.run({ sql: `INSERT INTO bench(k, v) VALUES (${P(1)}, ${P(2)})`, params: [k, mkPayload(k)] });
  k++;
  if (r.ok) { ok++; lastSize = r.meta?.size_after ?? lastSize; if (ok % 25 === 0) console.log(`  ok=${ok} size_after=${lastSize}`); }
  else { wall = record(name, 'slack-insert', r, { atIter: i, okBefore: ok, sizeBefore: lastSize }); console.log(`  WALL after ${ok} single-row inserts: ${r.code} ${(r.message || '').slice(0, 90)}`); break; }
}

const headroomBytes = (wall && startSize != null && lastSize != null) ? (lastSize - startSize) : null;
const verdict = wall
  ? `SLACK: ${ok} single-row inserts landed (~${headroomBytes} bytes of headroom) before the wall tripped → small writes are NOT exempt; they consume the sub-wall headroom. Ceiling pinned at last-success size_after=${lastSize}.`
  : `NO WALL after ${ok} inserts (~${(ok * rowBytes / 1048576).toFixed(1)}MB, ≫ headroom) → small size-increasing writes appear EXEMPT from the per-DB cap. Surprising for a storage cap; re-check before claiming.`;

const rec = {
  ts: new Date().toISOString(), target: name, control: useControl, phase: 'slack-probe',
  rowBytes, startSize, lastSuccessSize: lastSize, singleRowInsertsOk: ok,
  headroomBytesApprox: headroomBytes, hitWall: !!wall, wall: wall ?? '(no wall within backstop)', verdict,
};
appendJsonl(`slack-${name}${useControl ? '-control' : ''}.jsonl`, rec);
console.log('\n=== SLACK PROBE RESULT ===');
console.log(JSON.stringify(rec, null, 2));
console.log('\n' + verdict);
await t.close();
