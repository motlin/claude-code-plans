import { hmrPersist } from "./hmr-persist";

const VISIBILITY_LEASE_MS = 30_000;

interface VisibilityLease {
  sessionId: string;
  expiresAt: number;
}

const leases = hmrPersist("sessionVisibilityLeases", () => new Map<string, VisibilityLease>());

export function setSessionVisibility(
  clientId: string,
  sessionId: string,
  visible: boolean,
  now: number = Date.now(),
): void {
  if (visible) {
    leases.set(clientId, { sessionId, expiresAt: now + VISIBILITY_LEASE_MS });
    return;
  }

  const lease = leases.get(clientId);
  if (lease?.sessionId === sessionId) leases.delete(clientId);
}

export function isSessionVisible(sessionId: string, now: number = Date.now()): boolean {
  let visible = false;
  for (const [clientId, lease] of leases) {
    if (lease.expiresAt <= now) {
      leases.delete(clientId);
      continue;
    }
    if (lease.sessionId === sessionId) visible = true;
  }
  return visible;
}

export const __testing = {
  clear(): void {
    leases.clear();
  },
};
