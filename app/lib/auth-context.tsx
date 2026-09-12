import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import * as api from './api';
import type { ApiGroup, ApiMembership, ApiUser } from './api';

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

  async function loadMembership() {
    const { docs } = await api.myMemberships();
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

  useEffect(() => {
    (async () => {
      const token = await api.getToken();
      if (!token) {
        setStatus('signedOut');
        return;
      }
      try {
        const { user: restoredUser } = await api.me();
        if (!restoredUser) {
          await api.setToken(null);
          setStatus('signedOut');
          return;
        }
        setUser(restoredUser);
        await loadMembership();
      } catch {
        await api.setToken(null);
        setStatus('signedOut');
      }
    })();
  }, []);

  async function login(email: string, password: string) {
    const { user: loggedInUser, token } = await api.login(email, password);
    await api.setToken(token);
    setUser(loggedInUser);
    await loadMembership();
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
    await loadMembership();
  }

  async function refreshGroup() {
    await loadMembership();
  }

  async function logout() {
    await api.setToken(null);
    setUser(null);
    setGroup(null);
    setMembership(null);
    setStatus('signedOut');
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
