import React, { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearTokenPair, hasStoredSession, saveTokenPair } from './api';
import { AppAudience } from './mobile-modules';
import { deleteStoredItem, getStoredItem, setStoredItem } from './secure-storage';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export type MobileUser = {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  roles?: string[];
  taxpayerId?: string;
  isDemo?: boolean;
};

type AuthContextValue = {
  status: AuthStatus;
  audience: AppAudience;
  user: MobileUser | null;
  setAudience: (audience: AppAudience) => void;
  login: (input: { email: string; password: string; audience: AppAudience }) => Promise<void>;
  continueDemo: (audience: AppAudience) => Promise<void>;
  logout: () => Promise<void>;
};

const AUDIENCE_KEY = 'moren.mobile.audience';
const USER_KEY = 'moren.mobile.user';

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeRoles(user: any): string[] {
  if (Array.isArray(user?.roles)) return user.roles;
  if (Array.isArray(user?.userRoles)) {
    return user.userRoles.map((item: any) => item?.role?.name).filter(Boolean);
  }
  return [];
}

function sanitizeUser(raw: any): MobileUser {
  return {
    id: raw?.id || raw?.sub || 'unknown',
    email: raw?.email || '',
    firstName: raw?.firstName,
    lastName: raw?.lastName,
    roles: normalizeRoles(raw),
    taxpayerId: raw?.taxpayerId,
    isDemo: raw?.isDemo,
  };
}

async function storeAudience(audience: AppAudience) {
  await setStoredItem(AUDIENCE_KEY, audience);
}

async function storeUser(user: MobileUser | null) {
  if (!user) {
    await deleteStoredItem(USER_KEY);
    return;
  }
  await setStoredItem(USER_KEY, JSON.stringify(user));
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [audience, setAudienceState] = useState<AppAudience>('advisor');
  const [user, setUser] = useState<MobileUser | null>(null);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      const storedAudience = ((await getStoredItem(AUDIENCE_KEY)) || 'advisor') as AppAudience;
      const storedUser = await getStoredItem(USER_KEY);
      const hasSession = await hasStoredSession();

      if (!mounted) return;
      setAudienceState(storedAudience === 'taxpayer' ? 'taxpayer' : 'advisor');

      if (!hasSession) {
        if (storedUser) {
          setUser(JSON.parse(storedUser));
          setStatus('authenticated');
          return;
        }
        setStatus('unauthenticated');
        return;
      }

      try {
        const { data } = await api.get('/auth/me');
        const nextUser = sanitizeUser(data);
        await storeUser(nextUser);
        if (mounted) {
          setUser(nextUser);
          setStatus('authenticated');
        }
      } catch {
        await clearTokenPair();
        await storeUser(null);
        if (mounted) {
          setUser(null);
          setStatus('unauthenticated');
        }
      }
    }

    bootstrap();

    return () => {
      mounted = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      audience,
      user,
      setAudience: (nextAudience) => {
        setAudienceState(nextAudience);
        storeAudience(nextAudience);
      },
      login: async ({ email, password, audience: nextAudience }) => {
        const { data } = await api.post('/auth/login', {
          email,
          password,
          audience: nextAudience,
        });
        const nextUser = sanitizeUser(data.user || data);
        await saveTokenPair(data.accessToken, data.refreshToken);
        await storeAudience(nextAudience);
        await storeUser(nextUser);
        setAudienceState(nextAudience);
        setUser(nextUser);
        setStatus('authenticated');
      },
      continueDemo: async (nextAudience) => {
        const demoUser: MobileUser = {
          id: `demo-${nextAudience}`,
          email: nextAudience === 'advisor' ? 'ofis@moren.local' : 'mukellef@moren.local',
          firstName: nextAudience === 'advisor' ? 'Moren' : 'Mükellef',
          lastName: nextAudience === 'advisor' ? 'Ofis' : 'Portalı',
          roles: nextAudience === 'advisor' ? ['ADMIN'] : ['TAXPAYER'],
          isDemo: true,
        };
        await clearTokenPair();
        await storeAudience(nextAudience);
        await storeUser(demoUser);
        setAudienceState(nextAudience);
        setUser(demoUser);
        setStatus('authenticated');
      },
      logout: async () => {
        await clearTokenPair();
        await storeUser(null);
        setUser(null);
        setStatus('unauthenticated');
      },
    }),
    [audience, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return value;
}
