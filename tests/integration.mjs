// Exercises the production Next.js API, Supabase SDK HTTP calls and the actual
// PostgreSQL functions together. Uses an isolated PGlite database, no cloud keys.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { testDatabase, rpc, capability, sampleItem, sampleBackup } from './support.mjs';

const db = await testDatabase();
const testKey = 'local-integration-only-not-a-real-supabase-key';
let storageAvailable = true;
let app;
let output = '';
const bridge = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.headers.apikey !== testKey) { res.writeHead(401); res.end(JSON.stringify({ code: 'PGRST301', message: 'Invalid test key' })); return; }
  if (!storageAvailable) { res.writeHead(503); res.end(JSON.stringify({ code: 'TEST_UNAVAILABLE', message: 'Database unavailable' })); return; }
  const name = req.url?.split('/rest/v1/rpc/')[1];
  if (!['planner_read', 'planner_create', 'planner_mutate'].includes(name)) { res.writeHead(404); res.end('{}'); return; }
  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    res.end(JSON.stringify(await rpc(db, name, JSON.parse(body))));
  } catch (error) { res.writeHead(400); res.end(JSON.stringify({ code: error.code ?? 'TEST_ERROR', message: error.message })); }
});
await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
const backend = `http://127.0.0.1:${bridge.address().port}`;
try {
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, SUPABASE_URL: backend, SUPABASE_SECRET_KEY: testKey, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stdout.on('data', chunk => { output += chunk; });
  app.stderr.on('data', chunk => { output += chunk; });
  let origin;
  for (let i = 0; i < 150; i++) {
    if (app.exitCode !== null) throw new Error('Next.js exited before starting: ' + output);
    origin = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (origin && /Ready in/.test(output)) break;
    await delay(100);
  }
  assert.ok(origin, 'Production server did not become ready. Run npm run build first. ' + output);
  const token = capability();
  async function call(method = 'GET', body, key = token, extraHeaders = {}) {
    const response = await fetch(origin + '/api/plan', { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Our home shopping plan/);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await call('GET', undefined, '')).status, 401);
  assert.equal((await call('GET')).status, 404);
  let result = await call('POST', undefined, token, { Origin: origin });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  let plan = result.data;
  assert.equal(plan.personal + plan.gift, 1200000);
  assert.equal((await call('POST')).data.id, plan.id);
  assert.equal((await call('POST', undefined, token, { Origin: 'https://other.example' })).status, 403);
  const sofa = sampleItem({ backups: [sampleBackup()] });
  result = await call('PATCH', { action: 'save', revision: plan.revision, item: sofa });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  plan = result.data;
  assert.equal(plan.items[0].backups.length, 1);
  assert.deepEqual((await call()).data, plan);
  assert.match(result.headers.get('cache-control'), /no-store/);
  const simultaneous = await Promise.all([
    call('PATCH', { action: 'settings', revision: plan.revision, settings: { personal: 800000, gift: 200000, moveMonth: '2026-11' } }),
    call('PATCH', { action: 'settings', revision: plan.revision, settings: { personal: 900000, gift: 200000, moveMonth: '2026-11' } }),
  ]);
  assert.deepEqual(simultaneous.map(r => r.status).sort(), [200, 409]);
  plan = (await call()).data;
  const invalid = await call('PATCH', { action: 'save', revision: plan.revision, item: { ...sofa, image: 'javascript:alert(1)' } });
  assert.equal(invalid.status, 400);
  assert.deepEqual((await call()).data, plan);
  const tooLarge = await call('PATCH', { notes: 'x'.repeat(250001) });
  assert.equal(tooLarge.status, 413);
  storageAvailable = false;
  assert.equal((await call()).status, 503);
  storageAvailable = true;
  assert.deepEqual((await call()).data, plan);
  const lamp = sampleItem({ name: 'Lamp', sale: 0, priority: 2 });
  result = await call('PATCH', { action: 'save', revision: plan.revision, item: lamp });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  plan = result.data;
  result = await call('PATCH', { action: 'reorder', revision: plan.revision, ids: [lamp.id, sofa.id] });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  plan = result.data;
  assert.equal(plan.items[0].sale, 0);
  const oldRevision = plan.revision;
  result = await call('PATCH', { action: 'delete', revision: plan.revision, id: sofa.id });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  plan = result.data;
  assert.equal(plan.items.length, 1);
  assert.equal((await call('PATCH', { action: 'save', revision: oldRevision, item: sofa })).status, 409);
  console.log('PASS: production Next.js page + API, Supabase SDK, real PostgreSQL SQL, cloud-outage recovery, authorization, CRUD, backups, reorder, zero prices, persistence and concurrent-edit conflicts.');
} catch (error) {
  console.error(error);
  if (output) console.error(output);
  process.exitCode = 1;
} finally {
  if (app && app.exitCode === null) { const exited = once(app, 'exit'); app.kill('SIGTERM'); await exited; }
  await new Promise(resolve => bridge.close(resolve));
  await db.close();
}
