// selftest.mjs — offline checks. No credentials, no drivers, no network. `npm run selftest`.
import { payload, payloadHash } from '../lib/generator.mjs';
import { SEED, DIALECTS, WALLS, SAMPLING } from '../config.mjs';

let fails = 0;
const ok = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) fails++; };

// --- generator: deterministic, varies by k, high-entropy ---
const a = payload(SEED, 42, 64), b = payload(SEED, 42, 64), c = payload(SEED, 43, 64);
ok('payload length == requested', a.length === 64);
ok('payload deterministic (same seed,k)', Buffer.compare(a, b) === 0);
ok('payload varies by k', Buffer.compare(a, c) !== 0);
ok('payloadHash deterministic', payloadHash(SEED, 42, 64) === payloadHash(SEED, 42, 64));
const big = payload(SEED, 7, 4096);
ok(`payload high-entropy (distinct bytes ${new Set(big).size} > 200)`, new Set(big).size > 200);

// --- config sanity ---
ok('dialects pg + sqlite present', !!DIALECTS.pg && !!DIALECTS.sqlite);
ok('walls cover all 4 providers', ['supabase', 'neon', 'turso', 'd1'].every((p) => Array.isArray(WALLS[p])));
ok('D1 has storage + daily_read walls', WALLS.d1.length === 2 && WALLS.d1.some((w) => w.kind === 'daily_read'));
ok('D1 daily_read is ordered LAST', WALLS.d1.find((w) => w.kind === 'daily_read')?.order === 'LAST');
ok('D1 batch = floor(100/2) = 50', SAMPLING.D1_BATCH(2) === 50);
ok('pg fill payload uses STORAGE EXTERNAL', DIALECTS.pg.schema.some((s) => /STORAGE EXTERNAL/.test(s)));
ok('sqlite fill table has no secondary index (Turso rows-written)', !DIALECTS.sqlite.schema.some((s) => /CREATE INDEX/i.test(s)));
ok('sqlite has small readwall table for D1 daily-read', DIALECTS.sqlite.schema.some((s) => /readwall/.test(s)));

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILED'}`);
process.exit(fails === 0 ? 0 : 1);
