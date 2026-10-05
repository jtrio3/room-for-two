import { createHash } from 'node:crypto';
import { createPlan, mutatePlan, readPlan, StorageError } from '@/lib/server/supabase';
import { mutationSchema } from '@/lib/request';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_BODY_BYTES = 250_000;

function output(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Authorization',
    },
  });
}

function capabilityHash(request: Request): string | null {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  return token ? createHash('sha256').update(token).digest('hex') : null;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return true; // Non-browser callers must still possess the edit capability.
  const requestURL = new URL(request.url);
  const allowed = new Set([requestURL.origin]);
  // Next's internal URL can use its bind hostname instead of the browser-facing
  // hostname. Host still identifies the browser's same-origin request target.
  const host = request.headers.get('host');
  if (host) {
    try {
      const publicURL = new URL(requestURL.protocol + '//' + host);
      if (publicURL.host === host && !publicURL.username && !publicURL.password) allowed.add(publicURL.origin);
    } catch { /* Ignore malformed Host headers. */ }
  }
  // Netlify's server-side URL variables also cover the adapter's internal request origin.
  for (const url of [process.env.URL, process.env.DEPLOY_URL, process.env.DEPLOY_PRIME_URL]) {
    if (url) { try { allowed.add(new URL(url).origin); } catch { /* Ignore malformed host configuration. */ } }
  }
  return allowed.has(origin);
}

function failure(error: unknown) {
  const known = error instanceof StorageError;
  console.error('Planner storage request failed:', known ? error.code : 'UNEXPECTED_ERROR');
  return output({ error: known ? error.message : 'We could not confirm the save or load. Please reconnect and try again; keep any unsaved draft.' }, 503);
}

async function boundedJSON(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) throw new RangeError('This item is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('A JSON request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new RangeError('This item is too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function GET(request: Request) {
  const hash = capabilityHash(request);
  if (!hash) return output({ error: 'Open your shared plan link to view this list.' }, 401);
  try {
    const plan = await readPlan(hash);
    return plan ? output(plan) : output({ error: 'This plan link was not found. Check that you copied the whole link.' }, 404);
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return output({ error: 'Request not allowed.' }, 403);
  const hash = capabilityHash(request);
  if (!hash) return output({ error: 'A valid plan key is required.' }, 401);
  try { return output(await createPlan(hash), 201); } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return output({ error: 'Request not allowed.' }, 403);
  const hash = capabilityHash(request);
  if (!hash) return output({ error: 'Open your shared plan link to edit this list.' }, 401);
  let input: unknown;
  try { input = await boundedJSON(request); }
  catch (error) { return output({ error: error instanceof RangeError ? error.message : 'Invalid JSON request.' }, error instanceof RangeError ? 413 : 400); }
  const parsed = mutationSchema.safeParse(input);
  if (!parsed.success) return output({ error: parsed.error.issues[0].message }, 400);
  try {
    const result = await mutatePlan(hash, parsed.data);
    if (result.status === 200 && result.plan) return output(result.plan);
    if ([400, 404, 409].includes(result.status)) return output({ error: result.error ?? 'Could not save your change.', ...(result.plan ? { plan: result.plan } : {}) }, result.status);
    throw new StorageError('The database returned an unexpected response. Check that its setup script is up to date.', 'INVALID_RESPONSE');
  } catch (error) { return failure(error); }
}
