// d1-admin.mjs — minimal D1 REST admin so you can create/list databases WITHOUT the dashboard
// (useful when a brand-new account's D1 dashboard page won't render). Never prints the token.
//   node --env-file=.env bin/d1-admin.mjs create <name>
//   node --env-file=.env bin/d1-admin.mjs list
const acct = process.env.CF_ACCOUNT_ID, token = process.env.CF_API_TOKEN;
if (!acct || !token) { console.error('need CF_ACCOUNT_ID and CF_API_TOKEN in .env'); process.exit(1); }
const base = `https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database`;
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const [cmd, name] = process.argv.slice(2);

if (cmd === 'create') {
  if (!name) { console.error('usage: create <name>'); process.exit(1); }
  const r = await fetch(base, { method: 'POST', headers: H, body: JSON.stringify({ name }) });
  const b = await r.json().catch(() => ({}));
  if (!b.success) { console.error(`FAIL ${r.status}`, JSON.stringify(b.errors ?? b)); process.exit(2); }
  console.log(`${b.result.name}\t${b.result.uuid}`);
} else if (cmd === 'list') {
  const r = await fetch(base, { headers: H });
  const b = await r.json().catch(() => ({}));
  if (!b.success) { console.error(`FAIL ${r.status}`, JSON.stringify(b.errors ?? b)); process.exit(2); }
  if (!b.result?.length) console.log('(no databases)');
  for (const d of b.result) console.log(`${d.name}\t${d.uuid}`);
} else {
  console.error('usage: node --env-file=.env bin/d1-admin.mjs (create <name> | list)');
  process.exit(1);
}
