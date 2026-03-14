import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from 'react';
import type { User, PublicProfile, AvatarId, AvatarBgColor } from '@bull-em/shared';
import { socket } from '../socket.js';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';

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
  /** Update the avatar background color. Pass null to revert to index-based fallback. */
  updateAvatarBgColor: (avatarBgColor: AvatarBgColor | null) => Promise<void>;
  /** Upload a profile photo from device (admin only). Pass null to remove. */
  uploadPhoto: (photoDataUrl: string | null) => Promise<void>;
  /** Change the current user's username. */
  updateUsername: (username: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Vite proxies /auth and /api to the server in dev — relative URLs work from any device.
const API_BASE = '';

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) {
    throw new ApiError(data.error ?? `Request failed with status ${res.status}`, res.status);
  }
  return data;
}

/** Detect whether we're running inside a Capacitor native shell. */
function isCapacitorNative(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor;
  return cap != null
    && typeof cap.isNativePlatform === 'function'
    && cap.isNativePlatform() === true;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const handlingOAuthRef = useRef(false);

  const refreshProfile = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: User; profile: PublicProfile }>('/auth/me');
      setUser(data.user);
      setProfile(data.profile);
    } catch (err) {
      // Only clear user state on auth failures (401) — the session is truly invalid.
      // For server errors (500, 404) or network failures, keep existing user state
      // so a successful login isn't wiped out by a transient /auth/me failure.
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
        setProfile(null);
      }
    }
  }, []);

  // Check for existing session on mount
  useEffect(() => {
    refreshProfile().finally(() => setLoading(false));
  }, [refreshProfile]);

  // Handle OAuth deep links from the native app (bullem://auth-callback?token=<jwt>).
  // After OAuth completes in the Safari overlay (opened via Browser.open()), the server
  // redirects to this custom URL scheme which re-opens the native app. We close the
  // browser overlay, extract the token, exchange it for an httpOnly cookie via the
  // server, then refresh the auth state.
  useEffect(() => {
    if (!isCapacitorNative()) return;

    /** Process an OAuth callback URL from the bullem:// deep link. */
    function handleOAuthUrl(url: string): void {
      if (!url.startsWith('bullem://auth-callback')) return;
      if (handlingOAuthRef.current) return;
      handlingOAuthRef.current = true;

      // Close the Safari overlay that Browser.open() created for OAuth
      void Browser.close().catch(() => {});

      const params = new URL(url.replace('bullem://', 'https://placeholder/')).searchParams;
      const token = params.get('token');
      const error = params.get('error');

      if (error || !token) {
        window.location.href = '/login?error=oauth_failed';
        handlingOAuthRef.current = false;
        return;
      }

      // Exchange the token for an httpOnly cookie in WKWebView's cookie jar
      fetch(`${API_BASE}/auth/token-exchange`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error('Token exchange failed');
          await refreshProfile();
          socket.disconnect().connect();
          window.location.href = '/';
        })
        .catch(() => {
          window.location.href = '/login?error=oauth_failed';
        })
        .finally(() => {
          handlingOAuthRef.current = false;
        });
    }

    // Listen for deep links while the app is in the foreground
    const listener = CapacitorApp.addListener('appUrlOpen', (event: { url: string }) => {
      handleOAuthUrl(event.url);
    });

    // Handle cold-start deep links — if the app was killed and re-launched via
    // bullem:// URL, the appUrlOpen event may have fired before this listener
    // was registered. getLaunchUrl() catches that case.
    void CapacitorApp.getLaunchUrl().then((result) => {
      if (result?.url) {
        handleOAuthUrl(result.url);
      }
    });

    return () => {
      listener.then(h => h.remove());
    };
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

  const updateAvatarBgColor = useCallback(async (avatarBgColor: AvatarBgColor | null) => {
    await apiFetch<{ ok: boolean; avatarBgColor: AvatarBgColor | null }>('/auth/avatar-bg-color', {
      method: 'PATCH',
      body: JSON.stringify({ avatarBgColor }),
    });
    setUser(prev => prev ? { ...prev, avatarBgColor } : null);
    setProfile(prev => prev ? { ...prev, avatarBgColor } : null);
  }, []);

  const uploadPhoto = useCallback(async (photoDataUrl: string | null) => {
    const data = await apiFetch<{ ok: boolean; photoUrl: string | null }>('/auth/upload-photo', {
      method: 'POST',
      body: JSON.stringify({ photo: photoDataUrl }),
    });
    // Use the URL returned by the server (Tigris URL), not the data URL we sent
    setUser(prev => prev ? { ...prev, photoUrl: data.photoUrl } : null);
    setProfile(prev => prev ? { ...prev, photoUrl: data.photoUrl } : null);
  }, []);

  const updateUsername = useCallback(async (username: string) => {
    const data = await apiFetch<{ ok: boolean; username: string }>('/auth/username', {
      method: 'PATCH',
      body: JSON.stringify({ username }),
    });
    setUser(prev => prev ? { ...prev, username: data.username, displayName: data.username } : null);
    setProfile(prev => prev ? { ...prev, username: data.username, displayName: data.username } : null);
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
    updateAvatarBgColor,
    uploadPhoto,
    updateUsername,
  }), [user, profile, loading, login, register, logout, refreshProfile, updateAvatar, updateAvatarBgColor, uploadPhoto, updateUsername]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
