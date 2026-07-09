// capture.mjs — allowlist provenance. The PUBLISHED jsonl keeps only non-secret fields;
// raw (possibly secret-bearing) responses go to a git-ignored private file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RESULTS = fileURLToPath(new URL('../results', import.meta.url));
const RAW = path.join(RESULTS, 'raw');
fs.mkdirSync(RAW, { recursive: true });

const nowIso = () => new Date().toISOString();

// Allowlisted, publishable record built from a target.run() result.
export function record(target, op, r, extra = {}) {
  return {
    ts: nowIso(), target, op,
    ok: r.ok, status: r.status ?? null, code: r.code ?? null,
    message: r.message ?? null, rayId: r.rayId ?? null,
    ms: r.ms ?? null, meta: r.meta ?? null,
    ...extra,
  };
}

export function appendJsonl(file, rec) {
  fs.appendFileSync(path.join(RESULTS, file), JSON.stringify(rec) + '\n');
}

// Raw record → git-ignored private dir only (results/raw is in .gitignore).
export function appendRaw(file, obj) {
  fs.appendFileSync(path.join(RAW, file), JSON.stringify({ ts: nowIso(), ...obj }) + '\n');
}
