import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Plan } from '@/lib/planner';
import type { MutationInput } from '@/lib/request';

export class StorageError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'StorageError';
  }
}

let client: SupabaseClient | undefined;
function database() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret || url.includes('YOUR_PROJECT_ID') || secret === 'YOUR_SUPABASE_SECRET_KEY') {
    throw new StorageError(
      'Supabase is not connected yet. Add SUPABASE_URL and SUPABASE_SECRET_KEY in your hosting settings, then redeploy.',
      'NOT_CONFIGURED',
    );
  }
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new StorageError('The Supabase project URL is invalid.', 'INVALID_URL'); }
  if (parsed.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new StorageError('The Supabase project URL must use HTTPS.', 'INVALID_URL');
  }
  client = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
  return client;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await database().rpc(name, args).abortSignal(AbortSignal.timeout(15_000));
  if (error) {
    // Log only the code: database error details can contain private plan content.
    const code = error.code || 'SUPABASE_UNAVAILABLE';
    if (code === 'PGRST202' || code === '42P01') {
      throw new StorageError('The database setup is missing. Run supabase/setup.sql in your Supabase SQL Editor.', code);
    }
    if (code === 'PGRST301' || code === '42501') {
      throw new StorageError('The server cannot access Supabase. Check the server secret key and run the database setup script.', code);
    }
    throw new StorageError('Cloud storage is temporarily unavailable. Please try again.', code);
  }
  return data as T;
}

export const readPlan = (hash: string) => rpc<Plan | null>('planner_read', { p_key_hash: hash });
export const createPlan = (hash: string) => rpc<Plan>('planner_create', { p_key_hash: hash });
export type MutationResult = { status: 200 | 400 | 404 | 409; plan?: Plan; error?: string };
export function mutatePlan(hash: string, input: MutationInput) {
  const { revision, ...action } = input;
  return rpc<MutationResult>('planner_mutate', { p_key_hash: hash, p_revision: revision, p_action: action });
}
