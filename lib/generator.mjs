// generator.mjs — deterministic high-entropy payloads.
// High-entropy so bytes actually count toward storage walls (compressible repeats would be deflated
// by TOAST/page compression and undercount). Deterministic (seeded) so runs are reproducible and
// sentinel hashes are computable offline.

// mulberry32: tiny deterministic PRNG (32-bit).
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic incompressible buffer of `bytes` for row index `k`, given a base seed.
// Same (seed, k, bytes) → identical bytes, on any machine.
export function payload(seed, k, bytes) {
  const rnd = mulberry32((seed ^ (k * 0x9e3779b9)) >>> 0);
  const buf = Buffer.allocUnsafe(bytes);
  for (let i = 0; i < bytes; i++) buf[i] = (rnd() * 256) & 0xff;
  return buf;
}

// SHA-256 of a payload (for sentinel expected-hash, computed offline).
import { createHash } from 'node:crypto';
export function payloadHash(seed, k, bytes) {
  return createHash('sha256').update(payload(seed, k, bytes)).digest('hex');
}
