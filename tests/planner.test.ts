import assert from 'node:assert/strict';
import { test } from 'node:test';
import { metrics, emptyItem, isPurchased, moveItem, promote, itemSchema, groupSchema, type Item, type Group } from '../lib/planner.ts';
import { groupMembers, sortedGroups, groupMetrics, membershipChanges, membershipIntent, rebaseGroupSelection } from '../lib/groups.ts';
import { mutationSchema } from '../lib/request.ts';

const item = (name: string, patch: Partial<Item> = {}): Item => ({ ...emptyItem(), name, ...patch });
const group = (name: string): Group => ({ id: crypto.randomUUID(), name, notes: '' });

test('expected spend uses integer cents, honors free expected prices and excludes backups', () => {
  const sofa = item('Sofa', { regular: 50000, sale: 40000, backups: [item('Backup', { regular: 30000 })] });
  const lamp = item('Free lamp', { regular: 10000, sale: 0, need: 'later' });
  const m = metrics({ personal: 1000000, gift: 200000, items: [sofa, lamp] });
  assert.deepEqual(m, {
    budgeted: 40000, highEnd: 60000, cushion: 20000, actualSpent: 0, purchasedCount: 0, toBuyCount: 2,
    toBuyBudgeted: 40000, unknownToBuy: 0, projectedSpend: 40000,
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

test('actual spending counts only purchased main items and leaves planned budget metrics unchanged', () => {
  const purchased = item('Sofa', {
    regular: 60000, sale: 50000, purchasePrice: 44999,
    backups: [item('Alternative', { sale: 39999, purchasePrice: 10000 })],
  });
  const free = item('Gifted lamp', { regular: 5000, sale: 2500, purchasePrice: 0 });
  const waiting = item('Speakers', { regular: 15000, sale: 10000 });
  const m = metrics({ personal: 100000, gift: 0, items: [purchased, free, waiting] });
  assert.equal(m.actualSpent, 44999);
  assert.equal(m.purchasedCount, 2);
  assert.equal(m.toBuyCount, 1);
  assert.equal(m.toBuyBudgeted, 10000);
  assert.equal(m.projectedSpend, 54999);
  assert.equal(m.budgeted, 62500);
  assert.equal(m.highEnd, 80000);
  assert.equal(m.cushion, 17500);
  assert.equal(m.remaining, 37500);
  assert.equal(m.allocated, 62.5);
  assert.equal(m.budgeted, m.expected);
  assert.equal(m.highEnd, m.current);
  assert.equal(m.cushion, m.savings);
});

test('missing legacy purchase prices and unknown to-buy prices remain distinguishable from free purchases', () => {
  const { purchasePrice: _purchasePrice, ...legacy } = item('Legacy');
  const items = [legacy, item('Unpriced'), item('Free purchase', { purchasePrice: 0 }), item('Fallback', { regular: 1234 })];
  assert.equal(isPurchased(legacy), false);
  assert.equal(isPurchased(items[1]), false);
  assert.equal(isPurchased(items[2]), true);
  assert.equal(emptyItem().purchasePrice, null);
  const parsed = itemSchema.parse(legacy);
  assert.equal(Object.hasOwn(parsed, 'purchasePrice'), false);
  const m = metrics({ personal: 5000, gift: 0, items });
  assert.equal(m.actualSpent, 0);
  assert.equal(m.purchasedCount, 1);
  assert.equal(m.toBuyCount, 3);
  assert.equal(m.unknown, 3);
  assert.equal(m.unknownToBuy, 2);
  assert.equal(m.toBuyBudgeted, 1234);
  assert.equal(m.projectedSpend, 1234);
});

test('undoing a purchase removes actual spend and restores its to-buy budget', () => {
  const paid = item('Chair', { regular: 80000, sale: 70000, purchasePrice: 65000 });
  const before = metrics({ personal: 1200000, gift: 0, items: [paid] });
  const undone = { ...paid, purchasePrice: null };
  const after = metrics({ personal: 1200000, gift: 0, items: [undone] });
  assert.equal(isPurchased(undone), false);
  assert.equal(before.actualSpent, 65000);
  assert.equal(after.actualSpent, 0);
  assert.equal(after.purchasedCount, 0);
  assert.equal(after.toBuyBudgeted, 70000);
  assert.equal(after.projectedSpend, 70000);
  assert.equal(after.budgeted, before.budgeted);
  assert.equal(after.remaining, before.remaining);
});

test('linking purchased items changes neither actual spending nor whole-plan forecasts', () => {
  const setup = group('TV setup');
  const tv = item('TV', { sale: 100000, purchasePrice: 94999, groupId: setup.id });
  const mount = item('Mount', { sale: 5000, groupId: setup.id });
  const cable = item('Cable', { sale: 1500, purchasePrice: 0, groupId: setup.id });
  const items = [tv, mount, cable];
  const grouped = metrics({ personal: 1200000, gift: 0, items });
  const ungrouped = metrics({ personal: 1200000, gift: 0, items: items.map(entry => ({ ...entry, groupId: null })) });
  assert.deepEqual(grouped, ungrouped);
  const subtotal = groupMetrics(groupMembers({ items }, setup.id));
  assert.equal(subtotal.actualSpent, 94999);
  assert.equal(subtotal.purchasedCount, 2);
  assert.equal(subtotal.toBuyBudgeted, 5000);
  assert.equal(subtotal.projectedSpend, 99999);
});

test('a purchased item cannot promote a backup until its purchase has been undone', () => {
  const backup = item('Alternative sofa', { sale: 35000 });
  for (const price of [0, 40000]) {
    const paid = item('Sofa', { sale: 45000, purchasePrice: price, backups: [backup] });
    assert.equal(promote(paid, backup.id), paid);
    const undone = { ...paid, purchasePrice: null };
    const promoted = promote(undone, backup.id);
    assert.equal(promoted.name, backup.name);
    assert.equal(promoted.purchasePrice, null);
  }
});

test('purchase requests require an explicit bounded cent amount or null to undo', () => {
  const base = { action: 'purchase', revision: 1, id: crypto.randomUUID() };
  for (const price of [0, 1, 100000000, null]) {
    assert.equal(mutationSchema.safeParse({ ...base, price }).success, true);
  }
  for (const price of [-1, 1.1, 100000001, '100', undefined, NaN, Infinity]) {
    assert.equal(mutationSchema.safeParse({ ...base, price }).success, false);
  }
  assert.equal(mutationSchema.safeParse({ ...base, price: 10, id: 'bad-id' }).success, false);
  assert.equal(mutationSchema.safeParse({ ...base, price: 10, revision: -1 }).success, false);
  assert.equal(mutationSchema.safeParse({ ...base, price: 10, revision: 0.5 }).success, false);
  assert.equal(mutationSchema.safeParse({ ...base, price: 10, revision: undefined }).success, false);
  assert.equal(itemSchema.safeParse(item('Free', { purchasePrice: 0 })).success, true);
  assert.equal(itemSchema.safeParse(item('Invalid', { purchasePrice: -1 })).success, false);
  assert.equal(itemSchema.safeParse(item('Invalid', { purchasePrice: 0.5 })).success, false);
  assert.equal(itemSchema.safeParse(item('Invalid', { purchasePrice: 100000001 })).success, false);
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
