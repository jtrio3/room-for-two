import { z } from 'zod';

export const rooms = ['Living room', 'Bedroom', 'Kitchen & dining', 'Bathroom', 'Home office', 'Outdoors', 'Other'] as const;
export const safeUrl = z.string().trim().max(2048).refine(value => {
  if (!value) return true;
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}, 'Use a full http:// or https:// link.');
const cents = z.number().int().min(0).max(100000000);

// Keep the existing wire names so previously saved prices remain unchanged.
// regular = current price; sale = expected price (which may be higher or lower).
export const optionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Give this option a name.').max(160),
  url: safeUrl,
  image: safeUrl,
  regular: cents.nullable(),
  sale: cents.nullable(),
  notes: z.string().max(4000),
});
export const groupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Give this group a name.').max(60),
  notes: z.string().max(1000),
});
export const itemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Add an item name.').max(160),
  room: z.enum(rooms),
  need: z.enum(['now', 'later']),
  priority: z.number().int().min(1).max(301),
  groupId: z.string().uuid().nullable().optional(),
  url: safeUrl,
  image: safeUrl,
  regular: cents.nullable(),
  sale: cents.nullable(),
  notes: z.string().max(4000),
  backups: z.array(optionSchema).max(20),
}).superRefine((item, context) => {
  if (new Set(item.backups.map(backup => backup.id)).size !== item.backups.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['backups'], message: 'Duplicate backup option.' });
  }
});
export const settingsSchema = z.object({ personal: cents, gift: cents, moveMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) });
export type Option = z.infer<typeof optionSchema>;
export type Item = z.infer<typeof itemSchema>;
export type Group = z.infer<typeof groupSchema>;
export type Plan = { id: string; revision: number; personal: number; gift: number; moveMonth: string; updatedAt: number; items: Item[]; groups?: Group[] };

export const effectivePrice = (option: { regular: number | null; sale: number | null }) => option.sale ?? option.regular;
export const money = (value: number, decimals = false) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: decimals || value % 100 !== 0 ? 2 : 0, maximumFractionDigits: 2,
}).format(value / 100);

export function metrics(plan: Pick<Plan, 'personal' | 'gift' | 'items'>) {
  const total = plan.personal + plan.gift;
  let current = 0, expected = 0, savings = 0, overage = 0, immediate = 0;
  let unknown = 0, unknownExpected = 0, unknownCurrent = 0, usingCurrent = 0;
  for (const item of plan.items) {
    current += item.regular ?? 0;
    const price = effectivePrice(item);
    expected += price ?? 0;
    if (price === null) unknown++;
    if (item.sale === null) unknownExpected++;
    if (item.regular === null) unknownCurrent++;
    if (item.sale === null && item.regular !== null) usingCurrent++;
    if (item.regular !== null && item.sale !== null) {
      savings += Math.max(0, item.regular - item.sale);
      overage += Math.max(0, item.sale - item.regular);
    }
    if (item.need === 'now') immediate += price ?? 0;
  }
  return {
    total, current, expected, savings, overage, immediate, unknown, unknownExpected, unknownCurrent, usingCurrent,
    remaining: total - expected, allocated: total > 0 ? expected / total * 100 : null,
    // Backward-compatible names for consumers of the original summary.
    regular: current, sale: expected, unknownRegular: unknownCurrent,
  };
}

export function moveItem(items: Item[], id: string, rank: number) {
  const copy = items.filter(item => item.id !== id);
  const item = items.find(item => item.id === id);
  if (!item) return items;
  copy.splice(Math.max(0, Math.min(copy.length, rank - 1)), 0, item);
  return copy.map((entry, index) => ({ ...entry, priority: index + 1 }));
}

export function promote(item: Item, optionId: string): Item {
  const backup = item.backups.find(option => option.id === optionId);
  if (!backup) return item;
  const old: Option = {
    id: backup.id, name: item.name, url: item.url, image: item.image,
    regular: item.regular, sale: item.sale, notes: item.notes,
  };
  return {
    ...item, name: backup.name, url: backup.url, image: backup.image,
    regular: backup.regular, sale: backup.sale, notes: backup.notes,
    backups: item.backups.map(option => option.id === optionId ? old : option),
  };
}

export const emptyItem = (): Item => ({
  id: crypto.randomUUID(), name: '', room: 'Living room', need: 'now', priority: 1, groupId: null,
  url: '', image: '', regular: null, sale: null, notes: '', backups: [],
});
