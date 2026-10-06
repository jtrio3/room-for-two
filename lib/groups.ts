import { metrics, type Group, type Item, type Plan } from './planner.ts';

export function groupMembers(plan: Pick<Plan, 'items'>, groupId: string | null) {
  return plan.items.filter(item => (item.groupId ?? null) === groupId).sort((a, b) => a.priority - b.priority);
}

export function sortedGroups(plan: Pick<Plan, 'items' | 'groups'>): Group[] {
  const firstPriority = new Map<string, number>();
  for (const item of plan.items) {
    if (item.groupId) firstPriority.set(item.groupId, Math.min(firstPriority.get(item.groupId) ?? Infinity, item.priority));
  }
  return [...(plan.groups ?? [])].sort((a, b) => {
    const priorityA = firstPriority.get(a.id) ?? Infinity;
    const priorityB = firstPriority.get(b.id) ?? Infinity;
    return priorityA === priorityB ? a.name.localeCompare(b.name) : priorityA - priorityB;
  });
}

export const groupMetrics = (items: Item[]) => metrics({ personal: 0, gift: 0, items });

export function membershipIntent(baseMemberIds: string[], draftMemberIds: string[]) {
  const base = new Set(baseMemberIds), draft = new Set(draftMemberIds);
  return {
    added: [...draft].filter(id => !base.has(id)),
    removed: [...base].filter(id => !draft.has(id)),
  };
}

export type MembershipChanges = {
  added: Item[];
  removed: Item[];
  moved: Item[];
  deleted: Item[];
  // Selected items outside this group whose membership changed remotely.
  touched: Item[];
};

export function membershipChanges(baseItems: Item[], latestItems: Item[], groupId: string, draftMemberIds: string[] = []): MembershipChanges {
  const base = new Map(baseItems.map(item => [item.id, item]));
  const latest = new Map(latestItems.map(item => [item.id, item]));
  const changes: MembershipChanges = { added: [], removed: [], moved: [], deleted: [], touched: [] };
  for (const item of latestItems) {
    if (item.groupId === groupId && base.get(item.id)?.groupId !== groupId) changes.added.push(item);
  }
  for (const item of baseItems) {
    if (item.groupId !== groupId) continue;
    const updated = latest.get(item.id);
    if (!updated) changes.deleted.push(item);
    else if (updated.groupId && updated.groupId !== groupId) changes.moved.push(updated);
    else if (!updated.groupId) changes.removed.push(updated);
  }
  for (const id of new Set(draftMemberIds)) {
    const before = base.get(id), after = latest.get(id);
    if (!before || before.groupId === groupId || after?.groupId === groupId) continue;
    if (!after || (before.groupId ?? null) !== (after.groupId ?? null)) changes.touched.push(after ?? before);
  }
  return changes;
}

// Call only after the user chooses to review their changes. The returned
// selection still needs an explicit save against a newly confirmed revision.
export function rebaseGroupSelection(baseMemberIds: string[], draftMemberIds: string[], latestItems: Item[], groupId: string): string[] {
  const intent = membershipIntent(baseMemberIds, draftMemberIds);
  const latestIds = new Set(latestItems.map(item => item.id));
  const selection = new Set(latestItems.filter(item => item.groupId === groupId).map(item => item.id));
  for (const id of intent.removed) selection.delete(id);
  for (const id of intent.added) if (latestIds.has(id)) selection.add(id);
  return latestItems.filter(item => selection.has(item.id)).sort((a, b) => a.priority - b.priority).map(item => item.id);
}
