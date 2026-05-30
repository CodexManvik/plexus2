/**
 * Zustand store for authentication state.
 * Manages user session, tokens, and auth status.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, AuthState } from '../types/user';

interface AuthStore extends AuthState {
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  clearAuth: () => void;
  updateAccessToken: (accessToken: string) => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => {
      const isDev = import.meta.env.DEV || import.meta.env.MODE === 'development';
      return {
        user: isDev ? {
          user_id: '89BF383A5F3548AC98108947D04C2B43',
          email: 'admin@plexus.com',
          full_name: 'System Administrator (Dev Mode)',
          role: 'admin' as const,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } : null,
        accessToken: isDev ? 'mock_dev_access_token' : null,
        refreshToken: isDev ? 'mock_dev_refresh_token' : null,
        isAuthenticated: isDev ? true : false,

        setAuth: (user, accessToken, refreshToken) =>
          set({
            user,
            accessToken,
            refreshToken,
            isAuthenticated: true,
          }),

        clearAuth: () =>
          set({
            user: null,
            accessToken: null,
            refreshToken: null,
            isAuthenticated: false,
          }),

        updateAccessToken: (accessToken) =>
          set({ accessToken }),
      };
    },
    {
      name: 'plexus-auth',
      partialize: (state) => ({
        user: state.user,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
