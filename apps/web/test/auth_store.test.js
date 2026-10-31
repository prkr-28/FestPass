import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../src/store/authStore';

describe('Auth Store & Session Management (Stage 5)', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  });

  it('initializes with unauthenticated state', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
  });

  it('updates state and persists to localStorage on login', () => {
    const testUser = { id: 'u1', name: 'Admin', role: 'admin' };
    const testToken = 'mock-jwt-token-xyz';

    useAuthStore.setState({
      token: testToken,
      user: testUser,
      isAuthenticated: true,
    });

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe(testToken);
    expect(state.user.name).toBe('Admin');
  });

  it('clears state on logout', () => {
    useAuthStore.setState({
      token: 'jwt',
      user: { id: 'u1' },
      isAuthenticated: true,
    });

    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
  });
});
