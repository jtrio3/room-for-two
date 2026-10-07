import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { testDatabase, rpc, capability, hash, sampleItem, sampleBackup, sampleGroup } from './support.mjs';

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
    assert.deepEqual(plan.groups, []);
    assert.equal((await rpc(db, 'planner_create', { p_key_hash: key })).id, plan.id);
    assert.equal(await rpc(db, 'planner_read', { p_key_hash: otherKey }), null);
  });
  const sofa = sampleItem({ backups: [sampleBackup(), sampleBackup({ name: 'Second alternative' })] });
  const lamp = sampleItem({ name: 'Free lamp', regular: 10000, sale: 0, need: 'later' });
  await t.test('stores backup options, respects zero expected prices, and appends new items', async () => {
    let result = await mutate({ action: 'save', item: sofa });
    assert.equal(result.status, 200, result.error);
    plan = result.plan;
    assert.equal(plan.revision, 1);
    assert.equal(plan.items[0].backups.length, 2);
    result = await mutate({ action: 'save', item: lamp });
    assert.equal(result.status, 200, result.error);
    plan = result.plan;
    assert.equal(plan.items[1].id, lamp.id);
    assert.equal(plan.items[1].sale, 0);
    assert.equal(plan.items[0].id, sofa.id);
    assert.deepEqual(plan.items.map(i => i.priority), [1, 2]);
    assert.deepEqual(await rpc(db, 'planner_read', { p_key_hash: key }), plan);
  });
  await t.test('reorders atomically and rejects a stale second edit', async () => {
    const old = plan.revision;
    const result = await mutate({ action: 'reorder', ids: [lamp.id, sofa.id] });
    assert.equal(result.status, 200, result.error);
    plan = result.plan;
    assert.equal(plan.items[0].id, lamp.id);
    assert.deepEqual(plan.items.map(i => i.priority), [1, 2]);
    const conflict = await mutate({ action: 'delete', id: lamp.id }, old);
    assert.equal(conflict.status, 409);
    assert.deepEqual(conflict.plan, plan);
  });
  await t.test('invalid changes preserve the entire prior state', async () => {
    for (const action of [
      { action: 'reorder', ids: [sofa.id, sofa.id] },
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
      await assert.rejects(db.query('SELECT * FROM public.item_groups'), /permission denied/);
      await assert.rejects(db.query('SELECT public.planner_valid_group($1::jsonb)', ['{}']), /permission denied/);
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

const withoutMembership = (items) => items.map(({ groupId, ...item }) => item);
const upgradeSql = () => readFile(new URL('../supabase/migrations/20261005_groups_expected_price.sql', import.meta.url), 'utf8');

test('groups change membership without duplicating or repricing purchases', async (t) => {
  const db = await testDatabase();
  t.after(() => db.close());
  const key = hash(capability());
  const otherKey = hash(capability());
  let plan = await rpc(db, 'planner_create', { p_key_hash: key });
  const read = () => rpc(db, 'planner_read', { p_key_hash: key });
  const mutate = (action, revision = plan.revision, keyHash = key) => rpc(db, 'planner_mutate', { p_key_hash: keyHash, p_revision: revision, p_action: action });
  const save = async (action) => {
    const result = await mutate(action);
    assert.equal(result.status, 200, result.error);
    assert.equal(result.plan.revision, plan.revision + 1);
    plan = result.plan;
    return plan;
  };
  const tv = sampleItem({ name: 'TV', regular: 89900, sale: 99900, backups: [sampleBackup({ regular: 1000, sale: 1100 })] });
  const mount = sampleItem({ name: 'Wall mount', regular: 12900, sale: 9900 });
  const speakers = sampleItem({ name: 'Speakers', regular: 40000, sale: 34900, need: 'later' });
  const cable = sampleItem({ name: 'Cable', regular: null, sale: 0 });
  const tvGroup = sampleGroup();
  const audioGroup = sampleGroup({ name: 'Audio', notes: '' });
  await t.test('expected prices may exceed current prices for items and alternatives', async () => {
    for (const item of [tv, mount, speakers, cable]) await save({ action: 'save', item });
    assert.deepEqual(plan.items.map(i => i.id), [tv.id, mount.id, speakers.id, cable.id]);
    assert.deepEqual(plan.items.map(i => i.priority), [1, 2, 3, 4]);
    assert.equal(plan.items[0].sale, 99900);
    assert.equal(plan.items[0].backups[0].sale, 1100);
  });
  let originalItems;
  await t.test('creates a group and keeps each purchase exactly once', async () => {
    originalItems = withoutMembership(plan.items);
    await save({ action: 'saveGroup', group: { ...tvGroup, name: '  TV setup  ' }, itemIds: [tv.id, mount.id, speakers.id] });
    assert.deepEqual(plan.groups, [tvGroup]);
    assert.deepEqual(plan.items.map(i => i.groupId), [tvGroup.id, tvGroup.id, tvGroup.id, null]);
    assert.deepEqual(withoutMembership(plan.items), originalItems);
    assert.equal(plan.items.reduce((total, i) => total + (i.sale ?? i.regular ?? 0), 0), 144700);
  });
  await t.test('renames, unlinks, and moves members without touching item details', async () => {
    await save({ action: 'saveGroup', group: audioGroup, itemIds: [speakers.id] });
    assert.deepEqual(plan.items.map(i => i.groupId), [tvGroup.id, tvGroup.id, audioGroup.id, null]);
    await save({ action: 'saveGroup', group: { ...tvGroup, name: 'Cinema', notes: 'Measure the mount.' }, itemIds: [tv.id, cable.id] });
    assert.deepEqual(plan.items.map(i => i.groupId), [tvGroup.id, null, audioGroup.id, tvGroup.id]);
    assert.equal(plan.groups.find(g => g.id === tvGroup.id).name, 'Cinema');
    assert.deepEqual(withoutMembership(plan.items), originalItems);
  });
  await t.test('old-client item saves preserve membership and position', async () => {
    const legacy = { ...tv, name: 'Updated TV', priority: 4 };
    await save({ action: 'save', item: legacy });
    assert.equal(plan.items[0].groupId, tvGroup.id);
    assert.equal(plan.items[0].priority, 1);
    assert.equal(plan.items[0].name, 'Updated TV');
    await save({ action: 'save', item: { ...plan.items[0], groupId: null, priority: 4 } });
    assert.equal(plan.items[0].groupId, null);
    assert.deepEqual(plan.items.map(i => i.id), [tv.id, mount.id, speakers.id, cable.id]);
  });
  await t.test('invalid members, names, and group IDs leave everything unchanged', async () => {
    const prior = plan;
    for (const action of [
      { action: 'saveGroup', group: sampleGroup({ name: ' cinema ' }), itemIds: [] },
      { action: 'saveGroup', group: { ...audioGroup, name: 'CINEMA' }, itemIds: [] },
      { action: 'saveGroup', group: sampleGroup({ name: ' ' }), itemIds: [] },
      { action: 'saveGroup', group: sampleGroup({ name: 'x'.repeat(61) }), itemIds: [] },
      { action: 'saveGroup', group: sampleGroup({ notes: 'x'.repeat(1001) }), itemIds: [] },
      { action: 'saveGroup', group: {}, itemIds: [] },
      { action: 'saveGroup', group: null, itemIds: [] },
      { action: 'saveGroup', group: tvGroup, itemIds: [tv.id, tv.id] },
      { action: 'saveGroup', group: tvGroup, itemIds: [sampleItem().id] },
      { action: 'saveGroup', group: tvGroup, itemIds: [12] },
      { action: 'saveGroup', group: tvGroup, itemIds: null },
      { action: 'save', item: { ...tv, groupId: 'invalid' } },
      { action: 'save', item: { ...tv, groupId: sampleGroup().id } },
      { action: 'save', item: { ...tv, groupId: {} } },
      { action: 'removeGroup', id: 'invalid' },
    ]) {
      assert.equal((await mutate(action)).status, 400, JSON.stringify(action));
      assert.deepEqual(await read(), prior);
    }
  });
  await t.test('group and item identity never grants access to another plan', async () => {
    let other = await rpc(db, 'planner_create', { p_key_hash: otherKey });
    const foreign = sampleItem({ name: 'Other household only' });
    other = (await mutate({ action: 'save', item: foreign }, other.revision, otherKey)).plan;
    const foreignGroup = sampleGroup({ name: 'Other household group' });
    other = (await mutate({ action: 'saveGroup', group: foreignGroup, itemIds: [foreign.id] }, other.revision, otherKey)).plan;
    for (const action of [
      { action: 'saveGroup', group: tvGroup, itemIds: [foreign.id] },
      { action: 'save', item: { ...tv, groupId: foreignGroup.id } },
    ]) {
      assert.equal((await mutate(action)).status, 400);
      assert.deepEqual(await read(), plan);
      assert.deepEqual(await rpc(db, 'planner_read', { p_key_hash: otherKey }), other);
    }
    assert.equal((await mutate({ action: 'removeGroup', id: foreignGroup.id })).status, 404);
    // Reusing a UUID and name is safe because all identity and unique constraints include plan_id.
    other = (await mutate({ action: 'saveGroup', group: tvGroup, itemIds: [] }, other.revision, otherKey)).plan;
    assert.equal(other.groups.find(g => g.id === tvGroup.id).name, tvGroup.name);
    assert.equal(plan.groups.find(g => g.id === tvGroup.id).name, 'Cinema');
    assert.deepEqual(await read(), plan);
    await assert.rejects(db.query('UPDATE public.items SET group_id=$1 WHERE plan_id=$2 AND id=$3', [foreignGroup.id, plan.id, tv.id]), /foreign key/);
  });
  await t.test('stale membership replacement returns the newest plan without writes', async () => {
    const oldRevision = plan.revision;
    await save({ action: 'saveGroup', group: audioGroup, itemIds: [speakers.id, mount.id] });
    const result = await mutate({ action: 'saveGroup', group: audioGroup, itemIds: [speakers.id] }, oldRevision);
    assert.equal(result.status, 409);
    assert.deepEqual(result.plan, plan);
    assert.deepEqual(await read(), plan);
  });
  let inlineGroup;
  let inlineItem;
  await t.test('inline group and item creation commit together and append', async () => {
    inlineGroup = sampleGroup({ name: 'Reading corner', notes: '' });
    inlineItem = sampleItem({ name: 'Reading lamp', priority: 1, groupId: inlineGroup.id });
    await save({ action: 'save', item: inlineItem, newGroup: inlineGroup });
    assert.equal(plan.items.at(-1).id, inlineItem.id);
    assert.equal(plan.items.at(-1).priority, 5);
    assert.equal(plan.items.at(-1).groupId, inlineGroup.id);
    assert.deepEqual(plan.groups.find(g => g.id === inlineGroup.id), inlineGroup);
    const prior = plan;
    for (const [item, group] of [
      [sampleItem(), sampleGroup({ name: 'Missing link' })],
      [sampleItem({ groupId: tvGroup.id }), sampleGroup({ name: 'Mismatched link' })],
      [{ ...inlineItem }, inlineGroup],
      [{ ...tv, groupId: sampleGroup().id }, null],
    ]) {
      assert.equal((await mutate({ action: 'save', item, newGroup: group })).status, 400);
      assert.deepEqual(await read(), prior);
    }
  });
  await t.test('a failure after inline creation rolls back the group, item, backups, and revision', async () => {
    await db.exec(`RESET ROLE;
      CREATE FUNCTION public.test_reject_backup() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.notes = 'forced rollback' THEN RAISE check_violation USING MESSAGE = 'test rollback'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER test_reject_backup BEFORE INSERT ON public.backups FOR EACH ROW EXECUTE FUNCTION public.test_reject_backup();
      SET ROLE service_role;`);
    const rejectedGroup = sampleGroup({ name: 'Must roll back' });
    const result = await mutate({ action: 'save', newGroup: rejectedGroup,
      item: { ...plan.items[0], groupId: rejectedGroup.id, name: 'Must also roll back', backups: [sampleBackup({ notes: 'forced rollback' })] } });
    assert.equal(result.status, 400);
    assert.deepEqual(await read(), plan);
    await db.exec('RESET ROLE; DROP TRIGGER test_reject_backup ON public.backups; DROP FUNCTION public.test_reject_backup(); SET ROLE service_role;');
  });
  await t.test('removing a group unlinks members and preserves all purchases and backups', async () => {
    const priorItems = withoutMembership(plan.items);
    // The FK guards against an accidental direct cascade-delete of purchases.
    await assert.rejects(db.query('DELETE FROM public.item_groups WHERE plan_id=$1 AND id=$2', [plan.id, audioGroup.id]), /foreign key/);
    const oldRevision = plan.revision;
    await save({ action: 'removeGroup', id: audioGroup.id });
    assert.equal(plan.groups.some(g => g.id === audioGroup.id), false);
    assert.equal(plan.items.some(i => i.groupId === audioGroup.id), false);
    assert.deepEqual(withoutMembership(plan.items), priorItems);
    assert.equal((await mutate({ action: 'removeGroup', id: tvGroup.id }, oldRevision)).status, 409);
    assert.equal((await mutate({ action: 'removeGroup', id: audioGroup.id })).status, 404);
  });
  await t.test('deleting the last group member preserves an empty group', async () => {
    await save({ action: 'delete', id: inlineItem.id });
    assert.deepEqual(plan.groups.find(g => g.id === inlineGroup.id), inlineGroup);
    assert.equal(plan.items.some(i => i.groupId === inlineGroup.id), false);
    assert.deepEqual(plan.items.map(i => i.priority), [1, 2, 3, 4]);
  });
  await t.test('re-running migration and setup preserves groups and membership', async () => {
    await db.exec('RESET ROLE');
    await db.exec(await upgradeSql());
    await db.exec(await readFile(new URL('../supabase/setup.sql', import.meta.url), 'utf8'));
    await db.exec('SET ROLE service_role');
    assert.deepEqual(await read(), plan);
  });
});

test('v1 migration preserves existing data, capability hashes, timestamps, and list order', async (t) => {
  const db = await testDatabase(new URL('./fixtures/schema-v1.sql', import.meta.url));
  t.after(() => db.close());
  const key = hash(capability());
  let original = await rpc(db, 'planner_create', { p_key_hash: key });
  const sofa = sampleItem({ backups: [sampleBackup({ sale: 0 }), sampleBackup({ regular: null })] });
  const tv = sampleItem({ name: 'Existing TV', regular: null, sale: null });
  for (const item of [sofa, tv]) {
    const result = await rpc(db, 'planner_mutate', { p_key_hash: key, p_revision: original.revision, p_action: { action: 'save', item } });
    assert.equal(result.status, 200, result.error);
    original = result.plan;
  }
  assert.deepEqual(original.items.map(i => i.id), [tv.id, sofa.id]);
  assert.equal('groups' in original, false);
  const rawPlan = (await db.query('SELECT * FROM public.plans WHERE key_hash=$1', [key])).rows[0];
  const rawBackups = (await db.query('SELECT * FROM public.backups WHERE plan_id=$1 ORDER BY item_id,position', [original.id])).rows;
  await db.exec('RESET ROLE');
  await db.exec(await upgradeSql());
  await db.exec('SET ROLE service_role');
  const upgraded = await rpc(db, 'planner_read', { p_key_hash: key });
  assert.deepEqual(upgraded, { ...original, groups: [], items: original.items.map(i => ({ ...i, groupId: null })) });
  assert.deepEqual((await db.query('SELECT * FROM public.plans WHERE key_hash=$1', [key])).rows[0], rawPlan);
  assert.deepEqual((await db.query('SELECT * FROM public.backups WHERE plan_id=$1 ORDER BY item_id,position', [original.id])).rows, rawBackups);
  const group = sampleGroup();
  let result = await rpc(db, 'planner_mutate', { p_key_hash: key, p_revision: upgraded.revision, p_action: { action: 'saveGroup', group, itemIds: [sofa.id] } });
  assert.equal(result.status, 200, result.error);
  const legacySave = { ...sofa, sale: sofa.regular + 1000, priority: 1 };
  result = await rpc(db, 'planner_mutate', { p_key_hash: key, p_revision: result.plan.revision, p_action: { action: 'save', item: legacySave } });
  assert.equal(result.status, 200, result.error);
  assert.deepEqual(result.plan.items.map(i => i.id), [tv.id, sofa.id]);
  assert.equal(result.plan.items[1].groupId, group.id);
  assert.equal(result.plan.items[1].sale, sofa.regular + 1000);
  await db.exec('RESET ROLE');
  await db.exec(await upgradeSql());
  await db.exec('SET ROLE service_role');
  assert.deepEqual(await rpc(db, 'planner_read', { p_key_hash: key }), result.plan);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`RESET ROLE; SET ROLE ${role}`);
    await assert.rejects(db.query('SELECT * FROM public.item_groups'), /permission denied/);
    await assert.rejects(db.query('SELECT public.planner_read($1)', [key]), /permission denied/);
  }
});

test('group limit accepts edits and removals but rejects creation beyond 100', async (t) => {
  const db = await testDatabase();
  t.after(() => db.close());
  const key = hash(capability());
  let plan = await rpc(db, 'planner_create', { p_key_hash: key });
  await db.query("INSERT INTO public.item_groups (plan_id,id,name) SELECT $1,gen_random_uuid(),'Group ' || n FROM generate_series(1,100) n", [plan.id]);
  plan = await rpc(db, 'planner_read', { p_key_hash: key });
  const mutate = (action) => rpc(db, 'planner_mutate', { p_key_hash: key, p_revision: plan.revision, p_action: action });
  const extra = sampleGroup();
  const result = await mutate({ action: 'saveGroup', group: extra, itemIds: [] });
  assert.equal(result.status, 400);
  assert.match(result.error, /100 groups/);
  assert.equal((await mutate({ action: 'save', item: sampleItem({ groupId: extra.id }), newGroup: extra })).status, 400);
  assert.deepEqual(await rpc(db, 'planner_read', { p_key_hash: key }), plan);
  const renamed = { ...plan.groups[0], name: 'Renamed existing group' };
  plan = (await mutate({ action: 'saveGroup', group: renamed, itemIds: [] })).plan;
  assert.equal(plan.groups.length, 100);
  plan = (await mutate({ action: 'removeGroup', id: renamed.id })).plan;
  plan = (await mutate({ action: 'saveGroup', group: extra, itemIds: [] })).plan;
  assert.equal(plan.groups.length, 100);
});

const purchaseUpgradeSql = () => readFile(new URL('../supabase/migrations/20261006_purchase_tracking.sql', import.meta.url), 'utf8');
const actualTotal = (plan) => plan.items.reduce((sum, item) => sum + (item.purchasePrice ?? 0), 0);
const withoutPurchase = (items) => items.map(({ purchasePrice, ...item }) => item);

test('purchase tracking is explicit, revision guarded, and isolated from planning edits', async (t) => {
  const db = await testDatabase();
  t.after(() => db.close());
  const key = hash(capability());
  const otherKey = hash(capability());
  let plan = await rpc(db, 'planner_create', { p_key_hash: key });
  const read = () => rpc(db, 'planner_read', { p_key_hash: key });
  const mutate = (action, revision = plan.revision, keyHash = key) => rpc(db, 'planner_mutate', { p_key_hash: keyHash, p_revision: revision, p_action: action });
  const save = async (action) => {
    const result = await mutate(action);
    assert.equal(result.status, 200, result.error);
    assert.equal(result.plan.revision, plan.revision + 1);
    plan = result.plan;
    return plan;
  };
  const tv = sampleItem({ name: 'TV', regular: 99900, sale: 89900, backups: [sampleBackup()] });
  const mount = sampleItem({ name: 'Wall mount', regular: 12000, sale: 9900 });
  const group = sampleGroup();
  await t.test('new items are unpurchased and only a purchase action can set the amount', async () => {
    // Even an extra purchasePrice in a save payload cannot bypass the dedicated action.
    await save({ action: 'save', item: { ...tv, purchasePrice: 5000 } });
    await save({ action: 'save', item: mount });
    await save({ action: 'saveGroup', group, itemIds: [tv.id, mount.id] });
    assert.deepEqual(plan.items.map(item => item.purchasePrice), [null, null]);
    const plannedItems = withoutPurchase(plan.items);
    await save({ action: 'purchase', id: tv.id, price: 92001 });
    assert.deepEqual(plan.items.map(item => item.purchasePrice), [92001, null]);
    assert.equal(actualTotal(plan), 92001);
    assert.deepEqual(withoutPurchase(plan.items), plannedItems);
    assert.deepEqual(await read(), plan);
  });
  await t.test('a zero-cost purchase counts as purchased and editing a price replaces its contribution', async () => {
    await save({ action: 'purchase', id: mount.id, price: 0 });
    assert.equal(plan.items.filter(item => item.purchasePrice !== null).length, 2);
    assert.equal(actualTotal(plan), 92001);
    await save({ action: 'purchase', id: tv.id, price: 87050 });
    assert.equal(actualTotal(plan), 87050);
    assert.equal(plan.items.length, 2);
    assert.deepEqual(await read(), plan);
  });
  await t.test('invalid purchase amounts and IDs preserve the full state and revision', async () => {
    for (const price of [-1, 0.5, 100000001, '1200', 'null', {}, [], false]) {
      assert.equal((await mutate({ action: 'purchase', id: tv.id, price })).status, 400);
      assert.deepEqual(await read(), plan);
    }
    for (const action of [
      { action: 'purchase', id: tv.id },
      { action: 'purchase', id: 'invalid', price: 100 },
      { action: 'purchase', id: null, price: 100 },
      { action: 'purchase', price: 100 },
    ]) {
      assert.equal((await mutate(action)).status, 400);
      assert.deepEqual(await read(), plan);
    }
    assert.equal((await mutate({ action: 'purchase', id: sampleItem().id, price: 100 })).status, 404);
    assert.deepEqual(await read(), plan);
    await assert.rejects(db.query('UPDATE public.items SET purchase_price=-1 WHERE plan_id=$1 AND id=$2', [plan.id, tv.id]), /check constraint/);
    assert.deepEqual(await read(), plan);
  });
  await t.test('legacy item saves, forged purchase fields, and backup changes preserve actual spend', async () => {
    const { purchasePrice, ...legacyItem } = plan.items[0];
    await save({ action: 'save', item: { ...legacyItem, name: 'New TV label', sale: 91000 } });
    assert.equal(plan.items[0].purchasePrice, purchasePrice);
    await save({ action: 'save', item: { ...plan.items[0], purchasePrice: null, backups: [sampleBackup({ name: 'A different backup' })] } });
    assert.equal(plan.items[0].purchasePrice, purchasePrice);
    assert.equal(plan.items[0].backups[0].name, 'A different backup');
    await save({ action: 'save', item: { ...plan.items[0], purchasePrice: 1 } });
    assert.equal(actualTotal(plan), 87050);
    await save({ action: 'saveGroup', group: { ...group, name: 'Living room setup' }, itemIds: [tv.id] });
    await save({ action: 'reorder', ids: [mount.id, tv.id] });
    await save({ action: 'removeGroup', id: group.id });
    assert.equal(plan.items.find(item => item.id === tv.id).purchasePrice, purchasePrice);
    assert.equal(actualTotal(plan), 87050);
  });
  await t.test('stale purchase and undo requests return the newest plan without changing it', async () => {
    const oldRevision = plan.revision;
    await save({ action: 'purchase', id: mount.id, price: 100000000 });
    for (const price of [1200, null]) {
      const result = await mutate({ action: 'purchase', id: mount.id, price }, oldRevision);
      assert.equal(result.status, 409);
      assert.deepEqual(result.plan, plan);
      assert.deepEqual(await read(), plan);
    }
  });
  await t.test('another plan cannot purchase this plan’s items even with a known or reused UUID', async () => {
    let other = await rpc(db, 'planner_create', { p_key_hash: otherKey });
    const foreign = sampleItem({ name: 'Other household only' });
    other = (await mutate({ action: 'save', item: foreign }, other.revision, otherKey)).plan;
    assert.equal((await mutate({ action: 'purchase', id: foreign.id, price: 100 })).status, 404);
    assert.deepEqual(await read(), plan);
    assert.deepEqual(await rpc(db, 'planner_read', { p_key_hash: otherKey }), other);
    other = (await mutate({ action: 'save', item: { ...tv, name: 'Separate TV' } }, other.revision, otherKey)).plan;
    const result = await mutate({ action: 'purchase', id: tv.id, price: 2345 }, other.revision, otherKey);
    assert.equal(result.status, 200, result.error);
    other = result.plan;
    assert.equal(actualTotal(other), 2345);
    assert.deepEqual(await read(), plan);
    assert.equal((await mutate({ action: 'purchase', id: tv.id, price: null }, 0, hash(capability()))).status, 404);
  });
  await t.test('a failure after the amount is written rolls back the purchase and revision', async () => {
    await db.exec(`RESET ROLE;
      CREATE FUNCTION public.test_reject_revision() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE check_violation USING MESSAGE = 'forced rollback'; END; $$;
      CREATE TRIGGER test_reject_revision BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.test_reject_revision();
      SET ROLE service_role;`);
    const result = await mutate({ action: 'purchase', id: tv.id, price: 3333 });
    assert.equal(result.status, 400);
    assert.deepEqual(await read(), plan);
    await db.exec('RESET ROLE; DROP TRIGGER test_reject_revision ON public.plans; DROP FUNCTION public.test_reject_revision(); SET ROLE service_role;');
  });
  await t.test('undo clears the purchase while preserving item data; deletion removes its actual contribution', async () => {
    const prior = withoutPurchase(plan.items);
    await save({ action: 'purchase', id: mount.id, price: null });
    assert.equal(plan.items.find(item => item.id === mount.id).purchasePrice, null);
    assert.equal(actualTotal(plan), 87050);
    assert.deepEqual(withoutPurchase(plan.items), prior);
    await save({ action: 'delete', id: tv.id });
    assert.equal(actualTotal(plan), 0);
    assert.equal(plan.items[0].priority, 1);
    assert.equal((await mutate({ action: 'purchase', id: tv.id, price: 1 })).status, 404);
    assert.deepEqual(await read(), plan);
  });
  await t.test('re-running purchase migration and full setup preserves recorded purchase prices', async () => {
    await save({ action: 'purchase', id: mount.id, price: 0 });
    await db.exec('RESET ROLE');
    await db.exec(await purchaseUpgradeSql());
    await db.exec(await purchaseUpgradeSql());
    await db.exec(await readFile(new URL('../supabase/setup.sql', import.meta.url), 'utf8'));
    await db.exec('SET ROLE service_role');
    assert.deepEqual(await read(), plan);
  });
});

test('v1.1 purchase migration preserves all existing data and starts every item unpurchased', async (t) => {
  const db = await testDatabase(new URL('./fixtures/schema-v1.1.sql', import.meta.url));
  t.after(() => db.close());
  const key = hash(capability());
  let plan = await rpc(db, 'planner_create', { p_key_hash: key });
  const sofa = sampleItem({ backups: [sampleBackup({ sale: 0 }), sampleBackup({ regular: null })] });
  const mount = sampleItem({ name: 'Existing wall mount', regular: null, sale: null });
  const group = sampleGroup();
  for (const action of [
    { action: 'save', item: sofa }, { action: 'save', item: mount },
    { action: 'saveGroup', group, itemIds: [sofa.id, mount.id] },
    { action: 'reorder', ids: [mount.id, sofa.id] },
    { action: 'settings', settings: { personal: 800000, gift: 250000, moveMonth: '2027-11' } },
  ]) {
    const result = await rpc(db, 'planner_mutate', { p_key_hash: key, p_revision: plan.revision, p_action: action });
    assert.equal(result.status, 200, result.error);
    plan = result.plan;
  }
  assert.equal('purchasePrice' in plan.items[0], false);
  const snapshots = {};
  for (const table of ['plans', 'items', 'backups', 'item_groups']) {
    const condition = table === 'plans' ? 'id' : 'plan_id';
    snapshots[table] = (await db.query(`SELECT * FROM public.${table} WHERE ${condition}=$1 ORDER BY id`, [plan.id])).rows;
  }
  await db.exec('RESET ROLE');
  await db.exec(await purchaseUpgradeSql());
  await db.exec(await purchaseUpgradeSql());
  await db.exec('SET ROLE service_role');
  const upgraded = await rpc(db, 'planner_read', { p_key_hash: key });
  assert.deepEqual(upgraded, { ...plan, items: plan.items.map(item => ({ ...item, purchasePrice: null })) });
  for (const table of ['plans', 'items', 'backups', 'item_groups']) {
    const condition = table === 'plans' ? 'id' : 'plan_id';
    let rows = (await db.query(`SELECT * FROM public.${table} WHERE ${condition}=$1 ORDER BY id`, [plan.id])).rows;
    if (table === 'items') rows = rows.map(({ purchase_price, ...item }) => { assert.equal(purchase_price, null); return item; });
    assert.deepEqual(rows, snapshots[table]);
  }
  const result = await rpc(db, 'planner_mutate', { p_key_hash: key, p_revision: upgraded.revision, p_action: { action: 'purchase', id: sofa.id, price: 40525 } });
  assert.equal(result.status, 200, result.error);
  assert.equal(actualTotal(result.plan), 40525);
  assert.equal(result.plan.items[1].purchasePrice, 40525);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`RESET ROLE; SET ROLE ${role}`);
    await assert.rejects(db.query('SELECT purchase_price FROM public.items'), /permission denied/);
    await assert.rejects(db.query('SELECT public.planner_read($1)', [key]), /permission denied/);
    await assert.rejects(db.query('SELECT public.planner_mutate($1,$2,$3::jsonb)', [key, result.plan.revision, JSON.stringify({ action: 'purchase', id: sofa.id, price: 1 })]), /permission denied/);
  }
});
