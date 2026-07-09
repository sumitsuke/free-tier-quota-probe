// targets.mjs — per-provider adapters (reused/extended from serverless-db-bench Q3).
// Uniform interface:
//   const t = makeTarget('neon'); await t.open();  // or t.open(true) for the control sibling
//   const r = await t.run({ sql, params });        // r = { ms, ok, status?, code?, message?, meta?, rayId?, rows? }
//   await t.close();
// Drivers are dynamically imported so you only need the package for the target you actually run.

const env = (k) => { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
const nowMs = () => Number(process.hrtime.bigint() / 1_000_000n); // monotonic ms

export const ALL_TARGETS = ['supabase', 'neon', 'turso', 'd1'];

// --- Postgres (Supabase Supavisor session pooler / Neon pooler) via node-postgres ---
function pgTarget(name, urlEnv, controlEnv) {
  let client;
  return {
    name, dialect: 'pg', hasControl: !!process.env[controlEnv],
    async open(useControl = false) {
      const { default: pg } = await import('pg');
      const connectionString = useControl ? env(controlEnv) : env(urlEnv);
      client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
      await client.connect();
    },
    async run({ sql, params = [] }) {
      const t0 = nowMs();
      try {
        const res = await client.query(sql, params);
        return { ms: nowMs() - t0, ok: true, rows: res.rows, meta: { rowCount: res.rowCount } };
      } catch (e) {
        // e.code = SQLSTATE (e.g. 25006 read_only, 53100 disk_full); connection drops surface as ECONN*
        return { ms: nowMs() - t0, ok: false, code: e.code, message: String(e.message).slice(0, 500) };
      }
    },
    async close() { try { await client?.end(); } catch { /* ignore */ } },
  };
}

// --- Turso (libSQL, remote — NOT embedded replica) ---
function tursoTarget() {
  let client;
  return {
    name: 'turso', dialect: 'sqlite', hasControl: !!process.env.TURSO_CONTROL_URL,
    async open(useControl = false) {
      const { createClient } = await import('@libsql/client');
      client = createClient({
        url: useControl ? env('TURSO_CONTROL_URL') : env('TURSO_URL'),
        authToken: useControl ? env('TURSO_CONTROL_AUTH_TOKEN') : env('TURSO_AUTH_TOKEN'),
      });
    },
    async run({ sql, params = [] }) {
      const t0 = nowMs();
      try {
        const res = await client.execute({ sql, args: params });
        return { ms: nowMs() - t0, ok: true, rows: res.rows, meta: { rowsAffected: res.rowsAffected } };
      } catch (e) {
        // libSQL surfaces a code (e.g. server 'BLOCKED') on e.code / e.rawCode
        return { ms: nowMs() - t0, ok: false, code: e.code ?? e.rawCode, message: String(e.message).slice(0, 500) };
      }
    },
    async close() { try { client?.close(); } catch { /* ignore */ } },
  };
}

// --- Cloudflare D1 (REST /query — external host; Sessions API is Worker-only and not used here) ---
function d1Target() {
  let acct, token, dbid;
  return {
    name: 'd1', dialect: 'sqlite', hasControl: !!process.env.D1_CONTROL_DATABASE_ID,
    async open(useControl = false) {
      acct = env('CF_ACCOUNT_ID'); token = env('CF_API_TOKEN');
      dbid = useControl ? env('D1_CONTROL_DATABASE_ID') : env('D1_DATABASE_ID');
    },
    async run({ sql, params = [] }) {
      const t0 = nowMs();
      const url = `https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database/${dbid}/query`;
      const attempt = async () => {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql, params }),
          signal: AbortSignal.timeout(60000), // fail fast instead of hanging (a brand-new DB can stall its first query)
        });
        const rayId = resp.headers.get('cf-ray');
        const body = await resp.json().catch(() => ({}));
        const ok = resp.ok && body.success === true;
        return {
          ms: nowMs() - t0, ok, status: resp.status, rayId,
          rows: body.result?.[0]?.results,
          meta: body.result?.[0]?.meta ?? null, // { rows_read, rows_written, size_after, ... }
          code: ok ? undefined : body.errors?.[0]?.code,
          message: ok ? undefined : JSON.stringify(body.errors ?? body).slice(0, 500),
        };
      };
      try {
        return await attempt();
      } catch (e) {
        // one retry on timeout / transient network error (does not mask enforcement errors, which return ok:false, not throw)
        if (/time|abort|fetch failed|network|ENOTFOUND|ECONN/i.test(String(e.message))) {
          try { return await attempt(); } catch (e2) { return { ms: nowMs() - t0, ok: false, message: 'retry failed: ' + String(e2.message).slice(0, 400) }; }
        }
        return { ms: nowMs() - t0, ok: false, message: String(e.message).slice(0, 500) };
      }
    },
    async close() { /* stateless */ },
  };
}

export function makeTarget(name) {
  switch (name) {
    case 'supabase': return pgTarget('supabase', 'SUPABASE_URL', 'SUPABASE_CONTROL_URL');
    case 'neon':     return pgTarget('neon', 'NEON_URL', 'NEON_CONTROL_URL');
    case 'turso':    return tursoTarget();
    case 'd1':       return d1Target();
    default: throw new Error(`unknown target '${name}'. one of: ${ALL_TARGETS.join(', ')}`);
  }
}
