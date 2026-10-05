import type { Plan } from './planner.ts';

export type PlanAccess = { key: string; creating: boolean };
export type PlanSessionId = Readonly<{ key: string; generation: number }>;
export const accessStorageKey = 'room-for-two-access';
export const pendingStorageKey = 'room-for-two-pending';
const validKey = (key: string) => /^[a-f0-9]{64}$/.test(key);

// A failed first POST must retry the same capability, including after a reload.
export function resolvePlanAccess(hash: string | null, remembered: string, pending: string, previous: PlanAccess | null, createKey: () => string): PlanAccess {
  if (hash !== null && !validKey(hash)) throw new Error('This shared link is incomplete. Ask for a new copy of the full link.');
  const key = hash ?? previous?.key ?? (validKey(remembered) ? remembered : '');
  if (!key) return { key: createKey(), creating: true };
  return { key, creating: key === pending || (previous?.key === key && previous.creating) };
}

export class StalePlanSessionError extends Error {
  constructor() { super('The open plan changed.'); }
}

export class PlanSession {
  private session: PlanSessionId = { key: '', generation: 0 };
  private requests = new Set<AbortController>();
  private accepted: Plan | null = null;

  get identity() { return this.session; }
  get plan() { return this.accepted; }

  begin(key: string): PlanSessionId {
    for (const request of this.requests) request.abort();
    this.requests.clear();
    if (key !== this.session.key) this.accepted = null;
    this.session = { key, generation: this.session.generation + 1 };
    return this.session;
  }

  isActive(session: PlanSessionId) {
    return session.key === this.session.key && session.generation === this.session.generation;
  }

  accept(session: PlanSessionId, plan: Plan): boolean {
    if (!this.isActive(session)) return false;
    if (this.accepted && (plan.id !== this.accepted.id || plan.revision < this.accepted.revision)) return false;
    this.accepted = plan;
    return true;
  }

  async request(session: PlanSessionId, method = 'GET', body?: unknown, fetcher: typeof fetch = fetch, timeoutMs = 20000) {
    if (!this.isActive(session)) throw new StalePlanSessionError();
    const controller = new AbortController();
    this.requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher('/api/plan', {
        method,
        headers: { Authorization: 'Bearer ' + session.key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: controller.signal,
      });
      const data = await response.json() as Plan & { error?: string; plan?: Plan };
      if (!this.isActive(session)) throw new StalePlanSessionError();
      return { response, data };
    } finally {
      clearTimeout(timeout);
      this.requests.delete(controller);
    }
  }
}
