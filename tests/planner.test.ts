import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metrics, emptyItem, moveItem, promote, itemSchema, groupSchema, type Item, type Group } from '../lib/planner.ts';
import { groupMembers, sortedGroups, groupMetrics, membershipChanges, membershipIntent, rebaseGroupSelection } from '../lib/groups.ts';
import { mutationSchema } from '../lib/request.ts';

const item = (name: string, patch: Partial<Item> = {}): Item => ({ ...emptyItem(), name, ...patch });
const group = (name: string): Group => ({ id: crypto.randomUUID(), name, notes: '' });

test('expected spend uses integer cents, honors free expected prices and excludes backups', () => {
  const sofa = item('Sofa', { regular: 50000, sale: 40000, backups: [item('Backup', { regular: 30000 })] });
  const lamp = item('Free lamp', { regular: 10000, sale: 0, need: 'later' });
  const m = metrics({ personal: 1000000, gift: 200000, items: [sofa, lamp] });
  assert.deepEqual(m, {
    total: 1200000, current: 60000, expected: 40000, savings: 20000, overage: 0, immediate: 40000,
    unknown: 0, unknownExpected: 0, unknownCurrent: 0, usingCurrent: 0, remaining: 1160000,
    allocated: 40000 / 1200000 * 100, regular: 60000, sale: 40000, unknownRegular: 0,
  });
});

test('missing expected prices use current estimates with separate truthful unknown counts', () => {
  const m = metrics({ personal: 10000, gift: 0, items: [
    item('Current only', { regular: 3000 }), item('Expected only', { sale: 2500 }),
    item('Unpriced'), item('Free current', { regular: 0, need: 'later' }),
  ] });
  assert.equal(m.expected, 5500);
  assert.equal(m.current, 3000);
  assert.equal(m.immediate, 5500);
  assert.equal(m.unknown, 1);
  assert.equal(m.unknownExpected, 3);
  assert.equal(m.unknownCurrent, 2);
  assert.equal(m.usingCurrent, 2);
  assert.equal(m.remaining, 4500);
  assert.equal(m.allocated, 55.00000000000001);
  assert.equal(m.savings, 0);
});

test('higher expected prices increase spend and report overage without canceling savings', () => {
  const m = metrics({ personal: 5000, gift: 0, items: [
    item('Discount', { regular: 5000, sale: 3000 }), item('Extra cost', { regular: 1000, sale: 2000 }),
  ] });
  assert.equal(m.expected, 5000);
  assert.equal(m.savings, 2000);
  assert.equal(m.overage, 1000);
  assert.equal(m.remaining, 0);
});

test('zero budget and one-cent overspend stay truthful', () => {
  assert.equal(metrics({ personal: 0, gift: 0, items: [] }).allocated, null);
  assert.equal(metrics({ personal: 1200000, gift: 0, items: [item('Sofa', { sale: 1200001 })] }).remaining, -1);
});

test('reordering changes only internal order and promotion preserves membership, timing and rank', () => {
  const setup = group('TV setup');
  const main = item('Primary', { regular: 50000, sale: 45000, groupId: setup.id, need: 'later', backups: [item('Backup', { regular: 30000, sale: 32000 })] });
  const lamp = item('Lamp', { regular: 2500, priority: 2 });
  const reordered = moveItem([main, lamp], lamp.id, 1);
  assert.equal(reordered[0].id, lamp.id);
  assert.deepEqual(reordered.map(entry => entry.priority), [1, 2]);
  assert.equal(metrics({ personal: 0, gift: 0, items: reordered }).expected, 47500);
  const promoted = promote(reordered[1], main.backups[0].id);
  assert.equal(promoted.regular, 30000);
  assert.equal(promoted.sale, 32000);
  assert.equal(promoted.backups[0].sale, 45000);
  assert.equal(promoted.groupId, setup.id);
  assert.equal(promoted.priority, 2);
  assert.equal(promoted.need, 'later');
  assert.equal(metrics({ personal: 0, gift: 0, items: [promoted] }).expected, 32000);
});

test('price validation accepts expected above current but rejects unsafe links and invalid cents', () => {
  const base = item('Test');
  assert.equal(itemSchema.safeParse({ ...base, url: 'javascript:alert(1)' }).success, false);
  assert.equal(itemSchema.safeParse({ ...base, image: 'https://name:secret@example.com/image.jpg' }).success, false);
  assert.equal(itemSchema.safeParse({ ...base, regular: 10, sale: 11 }).success, true);
  assert.equal(itemSchema.safeParse({ ...base, regular: 10, sale: 0 }).success, true);
  assert.equal(itemSchema.safeParse({ ...base, sale: -1 }).success, false);
  assert.equal(itemSchema.safeParse({ ...base, sale: 1.5 }).success, false);
  assert.equal(itemSchema.safeParse({ ...base, sale: 100000001 }).success, false);
  const backup = item('Backup', { regular: 10, sale: 20 });
  assert.equal(itemSchema.safeParse({ ...base, backups: [backup] }).success, true);
  assert.equal(itemSchema.safeParse({ ...base, backups: [backup, backup] }).success, false);
});

test('groups are ordered by their first member, then empty names; missing groups stays compatible', () => {
  const first = group('TV setup'), second = group('Bedroom'), emptyZ = group('Zen'), emptyA = group('Artwork');
  const items = [item('Bed', { groupId: second.id, priority: 3 }), item('TV', { groupId: first.id, priority: 1 }), item('Mount', { groupId: first.id, priority: 2 }), item('Lamp', { priority: 4 })];
  const plan = { items, groups: [emptyZ, second, emptyA, first] };
  assert.deepEqual(sortedGroups(plan).map(entry => entry.id), [first.id, second.id, emptyA.id, emptyZ.id]);
  assert.deepEqual(groupMembers(plan, first.id).map(entry => entry.name), ['TV', 'Mount']);
  assert.deepEqual(groupMembers(plan, null).map(entry => entry.name), ['Lamp']);
  assert.deepEqual(sortedGroups({ items }), []);
  assert.equal(plan.groups[0].id, emptyZ.id);
});

test('group subtotals use each member once and linking does not change whole-plan totals', () => {
  const setup = group('TV setup');
  const tv = item('TV', { regular: 109900, sale: 99900, groupId: setup.id });
  const mount = item('Mount', { sale: 9900, groupId: setup.id });
  const speakers = item('Speakers', { sale: 34900, groupId: setup.id, need: 'later' });
  const other = item('Lamp', { sale: 0 });
  const members = groupMembers({ items: [tv, mount, speakers, other] }, setup.id);
  assert.equal(groupMetrics(members).expected, 144700);
  assert.equal(groupMetrics(members).immediate, 109800);
  assert.equal(groupMetrics(members).savings, 10000);
  assert.deepEqual(
    metrics({ personal: 1200000, gift: 0, items: [tv, mount, speakers, other] }),
    metrics({ personal: 1200000, gift: 0, items: [tv, mount, speakers, other].map(entry => ({ ...entry, groupId: null })) }),
  );
});

test('group validation trims names and requires valid bounds and IDs', () => {
  const setup = group('  TV setup  ');
  assert.equal(groupSchema.parse(setup).name, 'TV setup');
  assert.equal(groupSchema.safeParse({ ...setup, name: '  ' }).success, false);
  assert.equal(groupSchema.safeParse({ ...setup, name: 'x'.repeat(61) }).success, false);
  assert.equal(groupSchema.safeParse({ ...setup, notes: 'x'.repeat(1001) }).success, false);
  assert.equal(groupSchema.safeParse({ ...setup, id: 'invalid' }).success, false);
});

test('mutations validate group membership and preserve an omitted group field for old clients', () => {
  const setup = group('TV setup');
  const tv = item('TV', { groupId: setup.id });
  assert.equal(mutationSchema.safeParse({ action: 'saveGroup', revision: 0, group: setup, itemIds: [tv.id] }).success, true);
  assert.equal(mutationSchema.safeParse({ action: 'saveGroup', revision: 0, group: setup, itemIds: [tv.id, tv.id] }).success, false);
  assert.equal(mutationSchema.safeParse({ action: 'removeGroup', revision: 0, id: setup.id }).success, true);
  assert.equal(mutationSchema.safeParse({ action: 'save', revision: 0, item: tv, newGroup: setup }).success, true);
  assert.equal(mutationSchema.safeParse({ action: 'save', revision: 0, item: { ...tv, groupId: null }, newGroup: setup }).success, false);
  const { groupId: _groupId, ...legacy } = tv;
  const parsed = mutationSchema.parse({ action: 'save', revision: 0, item: legacy });
  assert.equal(parsed.action, 'save');
  if (parsed.action === 'save') assert.equal(Object.hasOwn(parsed.item, 'groupId'), false);
});

test('membership conflicts distinguish partner additions, removals, moves and deleted purchases', () => {
  const setup = group('TV setup'), bedroom = group('Bedroom');
  const added = item('Cable');
  const removed = item('TV', { groupId: setup.id });
  const moved = item('Speakers', { groupId: setup.id });
  const deleted = item('Mount', { groupId: setup.id });
  const candidate = item('Stand');
  const base = [added, removed, moved, deleted, candidate];
  const latest = [{ ...added, groupId: setup.id }, { ...removed, groupId: null }, { ...moved, groupId: bedroom.id }, { ...candidate, groupId: bedroom.id }];
  const changes = membershipChanges(base, latest, setup.id, [candidate.id]);
  assert.deepEqual(changes.added.map(entry => entry.name), ['Cable']);
  assert.deepEqual(changes.removed.map(entry => entry.name), ['TV']);
  assert.deepEqual(changes.moved.map(entry => entry.name), ['Speakers']);
  assert.equal(changes.moved[0].groupId, bedroom.id);
  assert.deepEqual(changes.deleted.map(entry => entry.name), ['Mount']);
  assert.deepEqual(changes.touched.map(entry => entry.name), ['Stand']);
});

test('review rebases only deliberate selection edits and keeps latest partner membership', () => {
  const setup = group('TV setup'), bedroom = group('Bedroom');
  const kept = item('TV', { groupId: setup.id, priority: 1 });
  const partnerMoved = item('Speakers', { groupId: setup.id, priority: 2 });
  const userRemoved = item('Mount', { groupId: setup.id, priority: 3 });
  const userAdded = item('Stand', { priority: 4 });
  const partnerAdded = item('Cable', { priority: 5 });
  const deleted = item('Old cable', { priority: 6 });
  const before = [kept.id, partnerMoved.id, userRemoved.id];
  const desired = [kept.id, partnerMoved.id, userAdded.id, deleted.id];
  const latest = [kept, { ...partnerMoved, groupId: bedroom.id }, userRemoved, userAdded, { ...partnerAdded, groupId: setup.id }];
  assert.deepEqual(membershipIntent(before, desired), { added: [userAdded.id, deleted.id], removed: [userRemoved.id] });
  assert.deepEqual(rebaseGroupSelection(before, desired, latest, setup.id), [kept.id, userAdded.id, partnerAdded.id]);
  assert.equal(latest[1].groupId, bedroom.id);
});

test('unchanged selection never restores old membership after a partner edit', () => {
  const setup = group('TV setup');
  const tv = item('TV', { groupId: setup.id });
  const mount = item('Mount', { groupId: setup.id });
  assert.deepEqual(rebaseGroupSelection([tv.id], [tv.id], [{ ...tv, groupId: null }, mount], setup.id), [mount.id]);
});
