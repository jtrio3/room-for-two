import { z } from 'zod';
import { itemSchema, settingsSchema } from './planner';

const revision = z.number().int().min(0).max(2147483646);
export const mutationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), revision, item: itemSchema }),
  z.object({ action: z.literal('delete'), revision, id: z.string().uuid() }),
  z.object({ action: z.literal('reorder'), revision, ids: z.array(z.string().uuid()).max(300) }),
  z.object({ action: z.literal('settings'), revision, settings: settingsSchema }),
]);
export type MutationInput = z.infer<typeof mutationSchema>;
