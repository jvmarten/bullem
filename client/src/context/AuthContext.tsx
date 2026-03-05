import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import type { User, PublicProfile } from '@bull-em/shared';

export interface AuthContextValue {
  user: User | null;
  profile: PublicProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const isCodespaces = typeof window !== 'undefined' && window.location.hostname.includes('.app.github.dev');
const API_BASE = import.meta.env.DEV && !isCodespaces ? 'http://localhost:3001' : '';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed with status ${res.status}`);
  }
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: User; profile: PublicProfile }>('/auth/me');
      setUser(data.user);
      setProfile(data.profile);
    } catch {
      setUser(null);
      setProfile(null);
    }
  }, []);

  // Check for existing session on mount
  useEffect(() => {
    refreshProfile().finally(() => setLoading(false));
  }, [refreshProfile]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiFetch<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setUser(data.user);
    // Fetch full profile with stats
    await refreshProfile();
  }, [refreshProfile]);

  const register = useCallback(async (username: string, email: string, password: string) => {
    const data = await apiFetch<{ user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
    setUser(data.user);
    await refreshProfile();
  }, [refreshProfile]);

  const logout = useCallback(async () => {
    await apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST' });
    setUser(null);
    setProfile(null);
  }, []);

  const value: AuthContextValue = useMemo(() => ({
    user,
    profile,
    loading,
    login,
    register,
    logout,
    refreshProfile,
  }), [user, profile, loading, login, register, logout, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
