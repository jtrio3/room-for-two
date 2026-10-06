import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const capability = () => randomBytes(32).toString('hex');
export const hash = (key) => createHash('sha256').update(key).digest('hex');
export const sampleItem = (changes = {}) => ({
  id: randomUUID(), name: 'Test sofa', room: 'Living room', need: 'now', priority: 1,
  url: 'https://example.com/sofa', image: '', regular: 50000, sale: 40000, notes: 'Measure before buying.', backups: [], ...changes,
});
export const sampleBackup = (changes = {}) => ({ id: randomUUID(), name: 'Backup sofa', url: '', image: '', regular: 35000, sale: null, notes: '', ...changes });
export const sampleGroup = (changes = {}) => ({ id: randomUUID(), name: 'TV setup', notes: 'Check connections before buying.', ...changes });
export async function testDatabase(schema = new URL('../supabase/setup.sql', import.meta.url)) {
  const db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  const setup = await readFile(schema, 'utf8');
  await db.exec(setup);
  await db.exec('SET ROLE service_role');
  return db;
}
export async function rpc(db, name, args) {
  // Explicit allowlist: the bridge never interpolates arbitrary SQL identifiers.
  const calls = {
    planner_read: ['SELECT public.planner_read($1) AS result', [args.p_key_hash]],
    planner_create: ['SELECT public.planner_create($1) AS result', [args.p_key_hash]],
    planner_mutate: ['SELECT public.planner_mutate($1, $2, $3::jsonb) AS result', [args.p_key_hash, args.p_revision, JSON.stringify(args.p_action)]],
  };
  if (!calls[name]) throw new Error('Unknown RPC');
  const [sql, values] = calls[name];
  return (await db.query(sql, values)).rows[0].result;
}
