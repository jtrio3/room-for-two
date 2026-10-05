import assert from 'node:assert/strict';
import test from 'node:test';
import { PlanSession, resolvePlanAccess, StalePlanSessionError } from '../lib/client.ts';
import type { Plan } from '../lib/planner.ts';

const keyA = 'a'.repeat(64);
const keyB = 'b'.repeat(64);
const plan = (revision: number, id = 'plan-a'): Plan => ({ id, revision, personal: 1000000, gift: 200000, moveMonth: '2026-11', updatedAt: revision, items: [] });

test('initial creation retries one capability, including after a reload', () => {
  let generated = 0;
  const create = () => { generated++; return keyA; };
  const first = resolvePlanAccess(null, '', '', null, create);
  assert.deepEqual(first, { key: keyA, creating: true });
  assert.deepEqual(resolvePlanAccess(null, '', '', first, create), first);
  assert.deepEqual(resolvePlanAccess(null, keyA, keyA, null, create), first);
  assert.deepEqual(resolvePlanAccess(keyA, keyA, keyA, null, create), first);
  assert.equal(generated, 1);
  assert.deepEqual(resolvePlanAccess(keyA, keyA, '', { key: keyA, creating: false }, create), { key: keyA, creating: false });
});

test('a shared link takes precedence without creating a missing shared plan', () => {
  const create = () => { throw new Error('Must not generate a key'); };
  assert.deepEqual(resolvePlanAccess(keyB, keyA, keyA, { key: keyA, creating: true }, create), { key: keyB, creating: false });
  assert.throws(() => resolvePlanAccess('invalid', keyA, '', null, create), /incomplete/);
  assert.throws(() => resolvePlanAccess('', keyA, '', null, create), /incomplete/);
});

test('a refresh that started before a save cannot roll back the saved revision', async () => {
  const session = new PlanSession();
  const identity = session.begin(keyA);
  session.accept(identity, plan(1));
  let complete!: (response: Response) => void;
  const refresh = session.request(identity, 'GET', undefined, (() => new Promise<Response>(resolve => { complete = resolve; })) as typeof fetch);
  session.accept(identity, plan(2));
  complete(Response.json(plan(1)));
  const stale = await refresh;
  assert.equal(session.accept(identity, stale.data), false);
  assert.equal(session.plan?.revision, 2);
});

test('switching plans aborts pending saves and discards late responses even if cancellation is ignored', async () => {
  const session = new PlanSession();
  const first = session.begin(keyA);
  session.accept(first, plan(8));
  let complete!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  let authorization: string | null = null;
  const pending = session.request(first, 'PATCH', { revision: 8 }, ((_url, init) => {
    signal = init?.signal;
    authorization = new Headers(init?.headers).get('Authorization');
    return new Promise<Response>(resolve => { complete = resolve; });
  }) as typeof fetch);
  const second = session.begin(keyB);
  assert.equal(signal?.aborted, true);
  assert.equal(authorization, 'Bearer ' + keyA);
  assert.equal(session.plan, null);
  session.accept(second, plan(0, 'plan-b'));
  complete(Response.json(plan(9)));
  await assert.rejects(pending, StalePlanSessionError);
  assert.equal(session.accept(first, plan(9)), false);
  assert.equal((session.plan as Plan | null)?.id, 'plan-b');
  await assert.rejects(session.request(first), StalePlanSessionError);
});

test('returning to the same key rejects an earlier visit and retains monotonic revisions on reconnect', () => {
  const session = new PlanSession();
  const first = session.begin(keyA);
  session.accept(first, plan(4));
  const reconnect = session.begin(keyA);
  assert.equal(session.plan?.revision, 4);
  assert.equal(session.accept(first, plan(8)), false);
  assert.equal(session.accept(reconnect, plan(3)), false);
  session.begin(keyB);
  const returned = session.begin(keyA);
  assert.equal(session.accept(first, plan(99)), false);
  assert.equal(session.accept(returned, plan(5)), true);
  assert.equal(session.accept(returned, plan(6, 'unrelated-plan')), false);
});

test('requests time out and release the request instead of leaving saves busy forever', async () => {
  const session = new PlanSession();
  const identity = session.begin(keyA);
  const waiting = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
  })) as typeof fetch;
  await assert.rejects(session.request(identity, 'PATCH', { revision: 0 }, waiting, 5), { name: 'AbortError' });
  const recovered = await session.request(identity, 'GET', undefined, (async () => Response.json(plan(1))) as typeof fetch);
  assert.equal(session.accept(identity, recovered.data), true);
});
