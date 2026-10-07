import { z } from 'zod';
import { groupSchema, itemSchema, settingsSchema } from './planner.ts';

const revision = z.number().int().min(0).max(2147483646);
export const mutationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), revision, item: itemSchema, newGroup: groupSchema.optional() }),
  z.object({ action: z.literal('delete'), revision, id: z.string().uuid() }),
  z.object({ action: z.literal('purchase'), revision, id: z.string().uuid(), price: z.number().int().min(0).max(100000000).nullable() }),
  z.object({ action: z.literal('reorder'), revision, ids: z.array(z.string().uuid()).max(300) }),
  z.object({ action: z.literal('settings'), revision, settings: settingsSchema }),
  z.object({
    action: z.literal('saveGroup'), revision, group: groupSchema,
    itemIds: z.array(z.string().uuid()).max(300).refine(ids => new Set(ids).size === ids.length, 'Select each item only once.'),
  }),
  z.object({ action: z.literal('removeGroup'), revision, id: z.string().uuid() }),
]).superRefine((mutation, context) => {
  if (mutation.action === 'save' && mutation.newGroup && mutation.item.groupId !== mutation.newGroup.id) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['item', 'groupId'], message: 'Choose the new group for this item.' });
  }
});
export type MutationInput = z.infer<typeof mutationSchema>;
