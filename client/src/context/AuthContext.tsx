import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import type { User, PublicProfile, AvatarId } from '@bull-em/shared';
import { socket } from '../socket.js';

export interface AuthContextValue {
  user: User | null;
  profile: PublicProfile | null;
  loading: boolean;
  /** Log in with email or username + password. */
  login: (identifier: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateAvatar: (avatar: AvatarId | null) => Promise<void>;
  /** Upload a profile photo from device (admin only). Pass null to remove. */
  uploadPhoto: (photoDataUrl: string | null) => Promise<void>;
  /** Change the current user's username. */
  updateUsername: (username: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Vite proxies /auth and /api to the server in dev — relative URLs work from any device.
const API_BASE = '';

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

  const login = useCallback(async (identifier: string, password: string) => {
    const data = await apiFetch<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    });
    setUser(data.user);
    // Reconnect socket so the handshake middleware picks up the new auth cookie.
    // Without this, socket.data.userId stays empty and ranked matchmaking rejects.
    socket.disconnect().connect();
    // Fetch full profile with stats
    await refreshProfile();
  }, [refreshProfile]);

  const register = useCallback(async (username: string, email: string, password: string) => {
    const data = await apiFetch<{ user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
    setUser(data.user);
    // Reconnect socket so the handshake middleware picks up the new auth cookie
    socket.disconnect().connect();
    await refreshProfile();
  }, [refreshProfile]);

  const logout = useCallback(async () => {
    await apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST' });
    setUser(null);
    setProfile(null);
    // Reconnect socket so the handshake drops the cleared auth cookie
    socket.disconnect().connect();
  }, []);

  const updateAvatar = useCallback(async (avatar: AvatarId | null) => {
    await apiFetch<{ ok: boolean; avatar: AvatarId | null }>('/auth/avatar', {
      method: 'PATCH',
      body: JSON.stringify({ avatar }),
    });
    // Update local state immediately without a full profile refetch
    setUser(prev => prev ? { ...prev, avatar } : null);
    setProfile(prev => prev ? { ...prev, avatar } : null);
  }, []);

  const uploadPhoto = useCallback(async (photoDataUrl: string | null) => {
    await apiFetch<{ ok: boolean; photoUrl: string | null }>('/auth/upload-photo', {
      method: 'POST',
      body: JSON.stringify({ photo: photoDataUrl }),
    });
    setUser(prev => prev ? { ...prev, photoUrl: photoDataUrl } : null);
    setProfile(prev => prev ? { ...prev, photoUrl: photoDataUrl } : null);
  }, []);

  const updateUsername = useCallback(async (username: string) => {
    const data = await apiFetch<{ ok: boolean; username: string }>('/auth/username', {
      method: 'PATCH',
      body: JSON.stringify({ username }),
    });
    setUser(prev => prev ? { ...prev, username: data.username } : null);
    setProfile(prev => prev ? { ...prev, username: data.username } : null);
  }, []);

  const value: AuthContextValue = useMemo(() => ({
    user,
    profile,
    loading,
    login,
    register,
    logout,
    refreshProfile,
    updateAvatar,
    uploadPhoto,
    updateUsername,
  }), [user, profile, loading, login, register, logout, refreshProfile, updateAvatar, uploadPhoto, updateUsername]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
