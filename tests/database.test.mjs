import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { testDatabase, rpc, capability, hash, sampleItem, sampleBackup } from './support.mjs';

test('PostgreSQL schema and transactional planner operations', async (t) => {
  const db = await testDatabase();
  t.after(() => db.close());
  const key = hash(capability());
  const otherKey = hash(capability());
  let plan;
  const mutate = (action, revision = plan.revision, keyHash = key) => rpc(db, 'planner_mutate', { p_key_hash: keyHash, p_revision: revision, p_action: action });
  await t.test('creates once and never exposes a hash', async () => {
    plan = await rpc(db, 'planner_create', { p_key_hash: key });
    assert.equal(plan.personal + plan.gift, 1200000);
    assert.equal(typeof plan.updatedAt, 'number');
    assert.equal('key_hash' in plan, false);
    assert.deepEqual(plan.items, []);
    assert.equal((await rpc(db, 'planner_create', { p_key_hash: key })).id, plan.id);
    assert.equal(await rpc(db, 'planner_read', { p_key_hash: otherKey }), null);
  });
  const sofa = sampleItem({ backups: [sampleBackup(), sampleBackup({ name: 'Second alternative' })] });
  const lamp = sampleItem({ name: 'Free lamp', regular: 10000, sale: 0, need: 'later' });
  await t.test('stores backup options and respects zero sale prices', async () => {
    let result = await mutate({ action: 'save', item: sofa });
    assert.equal(result.status, 200, result.error);
    plan = result.plan;
    assert.equal(plan.revision, 1);
    assert.equal(plan.items[0].backups.length, 2);
    result = await mutate({ action: 'save', item: lamp });
    assert.equal(result.status, 200, result.error);
    plan = result.plan;
    assert.equal(plan.items[0].id, lamp.id);
    assert.equal(plan.items[0].sale, 0);
    assert.deepEqual(plan.items.map(i => i.priority), [1, 2]);
    assert.deepEqual(await rpc(db, 'planner_read', { p_key_hash: key }), plan);
  });
  await t.test('reorders atomically and rejects a stale second edit', async () => {
    const old = plan.revision;
    const result = await mutate({ action: 'reorder', ids: [sofa.id, lamp.id] });
    assert.equal(result.status, 200, result.error);
    plan = result.plan;
    assert.equal(plan.items[0].id, sofa.id);
    assert.deepEqual(plan.items.map(i => i.priority), [1, 2]);
    const conflict = await mutate({ action: 'delete', id: lamp.id }, old);
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.plan, plan);
  });
  await t.test('invalid changes preserve the entire prior state', async () => {
    for (const action of [
      { action: 'reorder', ids: [sofa.id, sofa.id] },
      { action: 'save', item: { ...sofa, sale: sofa.regular + 1 } },
      { action: 'save', item: { ...sofa, regular: -1 } },
      { action: 'save', item: { ...sofa, regular: 0.5 } },
      { action: 'save', item: { ...sofa, url: 'javascript:alert(1)' } },
      { action: 'save', item: { ...sofa, backups: [sofa.backups[0], sofa.backups[0]] } },
      { action: 'settings', settings: { personal: 1, gift: 2, moveMonth: '2026-13' } },
    ]) {
      assert.equal((await mutate(action)).status, 400);
      assert.deepEqual(await rpc(db, 'planner_read', { p_key_hash: key }), plan);
    }
  });
  await t.test('same item IDs in another plan do not share data', async () => {
    const other = await rpc(db, 'planner_create', { p_key_hash: otherKey });
    const result = await mutate({ action: 'save', item: { ...sofa, name: 'Separate home' } }, other.revision, otherKey);
    assert.equal(result.status, 200, result.error);
    assert.equal(result.plan.items[0].name, 'Separate home');
    assert.deepEqual(await rpc(db, 'planner_read', { p_key_hash: key }), plan);
  });
  await t.test('budget changes and cascading deletes keep valid priorities', async () => {
    let result = await mutate({ action: 'settings', settings: { personal: 0, gift: 0, moveMonth: '2027-01' } });
    assert.equal(result.status, 200, result.error);
    plan = result.plan;
    assert.equal(plan.personal + plan.gift, 0);
    const beforeDelete = plan.revision;
    result = await mutate({ action: 'delete', id: sofa.id });
    assert.equal(result.status, 200, result.error);
    plan = result.plan;
    assert.equal(plan.items[0].priority, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.backups WHERE plan_id=$1 AND item_id=$2', [plan.id, sofa.id])).rows[0].n, 0);
    assert.equal((await mutate({ action: 'save', item: sofa }, beforeDelete)).status, 409);
    assert.equal((await mutate({ action: 'delete', id: sofa.id })).status, 404);
  });
  await t.test('anonymous and authenticated browser roles cannot read or execute', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec('RESET ROLE');
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query('SELECT * FROM public.plans'), /permission denied/);
      await assert.rejects(db.query('SELECT public.planner_read($1)', [key]), /permission denied/);
      await assert.rejects(db.query('SELECT public.planner_create($1)', [hash(capability())]), /permission denied/);
      await assert.rejects(db.query('SELECT public.planner_mutate($1,0,$2::jsonb)', [key, '{}']), /permission denied/);
    }
    await db.exec('RESET ROLE; SET ROLE service_role');
    assert.equal((await rpc(db, 'planner_read', { p_key_hash: key })).id, plan.id);
  });
  await t.test('re-running setup preserves saved plans', async () => {
    await db.exec('RESET ROLE');
    await db.exec(await readFile(new URL('../supabase/setup.sql', import.meta.url), 'utf8'));
    await db.exec('SET ROLE service_role');
    assert.deepEqual(await rpc(db, 'planner_read', { p_key_hash: key }), plan);
  });
});
