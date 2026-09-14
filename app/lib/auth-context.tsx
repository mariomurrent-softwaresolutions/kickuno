import { createContext, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import * as api from './api';
import type { ApiGroup, ApiMembership, ApiUser } from './api';

// Payload's default JWT lifetime is 7200s (2h, cms/src/collections/Users.ts
// doesn't override `tokenExpiration`). Refresh once less than half of that
// remains rather than waiting until the last minute — a device that's been
// asleep can wake up well past when a "just in time" refresh would have
// fired, and by then the token is already expired and unrefreshable.
const REFRESH_MARGIN_SECONDS = 60 * 60;
// Belt-and-suspenders re-check even if the app never backgrounds/foregrounds.
const REFRESH_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * `loading`  — checking for a stored token on app start.
 * `signedOut`— no valid session.
 * `needsGroup` — signed in, but no membership row yet (§3.5 step 2: join or
 *                create a group).
 * `ready`    — signed in and a group is loaded (v1 assumes one active group
 *              per user — implementation-plan.md §10 "multi-group per user").
 */
type Status = 'loading' | 'signedOut' | 'needsGroup' | 'ready';

type AuthState = {
  status: Status;
  user: ApiUser | null;
  group: ApiGroup | null;
  membership: ApiMembership | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  joinGroup: (code: string) => Promise<void>;
  createGroup: (name: string) => Promise<void>;
  /** Re-fetches the current membership/group — call after PATCHing group settings (§4.6). */
  refreshGroup: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<ApiUser | null>(null);
  const [group, setGroup] = useState<ApiGroup | null>(null);
  const [membership, setMembership] = useState<ApiMembership | null>(null);
  // Guards against overlapping refresh calls (e.g. the interval firing
  // right as the app comes back to foreground).
  const refreshing = useRef(false);

  async function loadMembership(userId: string) {
    const { docs } = await api.myMemberships(userId);
    const first = docs[0];
    if (!first) {
      setGroup(null);
      setMembership(null);
      setStatus('needsGroup');
      return;
    }
    setMembership(first);
    setGroup(typeof first.group === 'object' ? first.group : null);
    setStatus('ready');
  }

  /** Drops straight to the login screen — used both for a normal logout and for a 401 (dead/expired session) noticed elsewhere. */
  function forceSignOut() {
    setUser(null);
    setGroup(null);
    setMembership(null);
    setStatus('signedOut');
  }

  /**
   * Renews the session before the JWT actually expires (§ REFRESH_MARGIN_SECONDS
   * above) via Payload's `/refresh-token`, so a user who keeps the app
   * around doesn't get silently kicked out mid-session — see
   * api.ts#refreshToken for why a proactive renewal is needed at all
   * (Payload's token has a fixed ~2h lifetime and nothing else extends it).
   */
  async function maybeRefreshToken() {
    if (refreshing.current) return;
    const exp = await api.getTokenExpiry();
    if (exp == null) return;
    const secondsLeft = exp - Date.now() / 1000;
    if (secondsLeft > REFRESH_MARGIN_SECONDS) return;
    refreshing.current = true;
    try {
      const { exp: newExp, refreshedToken } = await api.refreshToken();
      await api.setSession(refreshedToken, newExp);
    } catch {
      // Token was already expired/invalid by the time we got to it (e.g.
      // the app was asleep for hours) — nothing to renew, so fall back to
      // a real sign-out instead of leaving a dead session lying around.
      if (secondsLeft <= 0) {
        await api.setToken(null);
        forceSignOut();
      }
    } finally {
      refreshing.current = false;
    }
  }

  // Registered once: any request anywhere that comes back 401 (api.ts)
  // means the session is dead — react the same way a normal logout would,
  // instead of leaving the UI looking signed-in while every call fails.
  useEffect(() => {
    api.setUnauthorizedHandler(forceSignOut);
    return () => api.setUnauthorizedHandler(null);
  }, []);

  // Proactive renewal while signed in: a periodic check, plus an immediate
  // one whenever the app comes back to the foreground (JS timers don't run
  // while backgrounded, so the interval alone would miss a token that
  // expired while the phone was asleep in the user's pocket).
  useEffect(() => {
    if (status !== 'ready' && status !== 'needsGroup') return;
    void maybeRefreshToken();
    const interval = setInterval(() => void maybeRefreshToken(), REFRESH_CHECK_INTERVAL_MS);
    function onAppStateChange(next: AppStateStatus) {
      if (next === 'active') void maybeRefreshToken();
    }
    const subscription = AppState.addEventListener('change', onAppStateChange);
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [status]);

  useEffect(() => {
    (async () => {
      const token = await api.getToken();
      if (!token) {
        setStatus('signedOut');
        return;
      }
      try {
        await maybeRefreshToken();
        const { user: restoredUser } = await api.me();
        if (!restoredUser) {
          await api.setToken(null);
          setStatus('signedOut');
          return;
        }
        setUser(restoredUser);
        await loadMembership(restoredUser.id);
      } catch {
        await api.setToken(null);
        setStatus('signedOut');
      }
    })();
  }, []);

  async function login(email: string, password: string) {
    const { user: loggedInUser, token, exp } = await api.login(email, password);
    await api.setSession(token, exp);
    setUser(loggedInUser);
    await loadMembership(loggedInUser.id);
  }

  async function register(name: string, email: string, password: string) {
    await api.register(name, email, password);
    // Registration (POST /api/users) does not itself return a session token
    // — log in right after with the same credentials.
    await login(email, password);
  }

  async function joinGroup(code: string) {
    const { group: joinedGroup, membership: newMembership } = await api.joinGroup(code);
    setGroup(joinedGroup);
    setMembership(newMembership);
    setStatus('ready');
  }

  async function createGroup(name: string) {
    await api.createGroup(name);
    // Groups.afterChange already created the admin membership server-side
    // (Groups.ts) — just reload it rather than re-deriving it here.
    if (user) await loadMembership(user.id);
  }

  async function refreshGroup() {
    if (user) await loadMembership(user.id);
  }

  async function logout() {
    await api.setToken(null);
    forceSignOut();
  }

  const value = useMemo<AuthState>(
    () => ({ status, user, group, membership, login, register, joinGroup, createGroup, refreshGroup, logout }),
    [status, user, group, membership]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
