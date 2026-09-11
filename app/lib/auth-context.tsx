import { createContext, useContext, useMemo, useState, type PropsWithChildren } from 'react';

type Membership = { groupId: string; role: 'admin' | 'organizer' | 'player' } | null;

type AuthState = {
  isAuthenticated: boolean;
  membership: Membership;
  login: () => void;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

/**
 * Stub auth state until the Payload backend exists.
 * TODO(cms): replace `login`/`logout` with real calls to
 * POST /api/users/login and POST /api/groups/join, persisting the JWT in
 * expo-secure-store — see documentation/implementation-plan.md §3.5.
 */
export function AuthProvider({ children }: PropsWithChildren) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [membership, setMembership] = useState<Membership>(null);

  const value = useMemo<AuthState>(
    () => ({
      isAuthenticated,
      membership,
      login: () => {
        setIsAuthenticated(true);
        setMembership({ groupId: 'demo', role: 'player' });
      },
      logout: () => {
        setIsAuthenticated(false);
        setMembership(null);
      },
    }),
    [isAuthenticated, membership]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
