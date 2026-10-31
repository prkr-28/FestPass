import { create } from 'zustand';
import { api } from '../api/client';

const STORAGE_KEY = 'festpass_auth';

function loadInitialState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.state?.token) {
        return {
          token: parsed.state.token,
          user: parsed.state.user || null,
          isAuthenticated: true,
        };
      }
    }
  } catch (_e) {}
  return {
    token: null,
    user: null,
    isAuthenticated: false,
  };
}

export const useAuthStore = create((set, get) => ({
  ...loadInitialState(),
  isLoading: false,
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post('/api/auth/login', { email, password });
      const { token, user } = res.data;

      const newState = { token, user, isAuthenticated: true, isLoading: false };
      set(newState);

      localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { token, user } }));
      return { success: true, user };
    } catch (err) {
      const message = err.response?.data?.error?.message || err.message || 'Login failed';
      set({ isLoading: false, error: message });
      return { success: false, error: message };
    }
  },

  logout: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ token: null, user: null, isAuthenticated: false, error: null });
  },

  fetchProfile: async () => {
    const { token } = get();
    if (!token) return;
    try {
      const res = await api.get('/api/auth/me');
      if (res.data?.user) {
        set({ user: res.data.user });
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ state: { ...stored.state, user: res.data.user } })
        );
      }
    } catch (err) {
      if (err.response?.status === 401) {
        get().logout();
      }
    }
  },
}));

// Listen for global auth expired events from the API client
if (typeof window !== 'undefined') {
  window.addEventListener('festpass:auth_expired', () => {
    useAuthStore.getState().logout();
  });
}
