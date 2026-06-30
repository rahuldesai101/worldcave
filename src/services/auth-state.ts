import { enqueueSentryCall } from '@/bootstrap/sentry-defer';
import { getCurrentClerkUser, scheduleClerkLoad, subscribeClerk } from './clerk';

/** Minimal user profile exposed to UI components. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  role: 'free' | 'pro';
}

/** Simplified auth session state for UI consumption. */
export interface AuthSession {
  user: AuthUser | null;
  isPending: boolean;
}

let _currentSession: AuthSession = { user: null, isPending: true };
const _localSubscribers = new Set<(state: AuthSession) => void>();

function notifyLocal(): void {
  for (const cb of _localSubscribers) {
    try { cb(_currentSession); } catch { /* swallow */ }
  }
}

function snapshotSession(): AuthSession {
  const cu = getCurrentClerkUser();
  if (!cu) {
    enqueueSentryCall((s) => s.setUser(null));
    return { user: null, isPending: false };
  }
  enqueueSentryCall((s) => s.setUser({ id: cu.id }));
  return {
    user: {
      id: cu.id,
      name: cu.name,
      email: cu.email,
      image: cu.image,
      role: cu.plan,
    },
    isPending: false,
  };
}

/**
 * Initialize auth state. Call once at app startup before UI subscribes.
 *
 * Does NOT await `initClerk()` — the @clerk/clerk-js bundle is ~2.98 MB
 * and 96% unused on first paint, so awaiting it here would block the
 * App.init() chain (panel layout, data fetches, etc.) on a load that
 * isn't needed until the user reaches for auth. Instead, schedule the
 * load via `scheduleClerkLoad()` (idle-callback after first paint).
 *
 * Leaves `_currentSession` at the module-level default
 * `{ user: null, isPending: true }` — calling `snapshotSession()` here
 * would flip `isPending` to `false` while `clerkInstance` is still
 * null, which subscribers cannot distinguish from a settled signed-out
 * session. Cookie-backed signed-in users would then see Sign In / the
 * locked-panel state for up to 4 s (the `requestIdleCallback` timeout)
 * before Clerk hydrates. The pending-callback queue in clerk.ts fires
 * the subscribeAuthState listener as soon as Clerk loads, snapshots
 * the real session, and flips `isPending` to `false`.
 */
export async function initAuthState(): Promise<void> {
  scheduleClerkLoad();
  // Safety net: if Clerk hasn't hydrated within 5s (e.g. missing key in
  // production bundle, network blocked), flip isPending to false so the
  // header renders Sign In / Create account buttons instead of skeletons.
  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      if (_currentSession.isPending) {
        _currentSession = { user: null, isPending: false };
        notifyLocal();
      }
    }, 5000);
  }
}

/**
 * Subscribe to reactive auth state changes.
 * @returns Unsubscribe function.
 */
export function subscribeAuthState(callback: (state: AuthSession) => void): () => void {
  // Emit current state immediately
  callback(_currentSession);
  _localSubscribers.add(callback);
  const unsubClerk = subscribeClerk(() => {
    _currentSession = snapshotSession();
    callback(_currentSession);
  });
  return () => {
    _localSubscribers.delete(callback);
    unsubClerk();
  };
}

/**
 * Synchronous snapshot of current auth state.
 */
export function getAuthState(): AuthSession {
  return _currentSession;
}
