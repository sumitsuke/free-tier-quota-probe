// ping.mjs — connectivity check for one target. `node --env-file=.env bin/ping.mjs --target d1`
// Prints ok/status/rows/meta (never the credentials). D1 needs no npm install (native fetch).
import { makeTarget } from '../lib/targets.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const name = arg('--target', 'd1');

const t = makeTarget(name);
await t.open();
const r = await t.run({ sql: 'SELECT 1 AS one', params: [] });
console.log(JSON.stringify({
  target: name, ok: r.ok, status: r.status ?? null, code: r.code ?? null,
  ms: r.ms, rows: r.rows ?? null, meta: r.meta ?? null,
  message: r.ok ? null : r.message,
}, null, 2));
await t.close();
process.exit(r.ok ? 0 : 1);
