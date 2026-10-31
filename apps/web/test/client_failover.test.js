import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getActiveBoothNode,
  getActiveGateNode,
  setActiveBoothNode,
  subscribeNodeChanges,
  BOOTH_NODES,
  GATE_NODES,
  resilientRequest,
} from '../src/api/client';
import axios from 'axios';

vi.mock('axios');

describe('Resilient API Client & Failover (Stage 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with default booth and gate nodes', () => {
    expect(getActiveBoothNode()).toBe(BOOTH_NODES[0]);
    expect(getActiveGateNode()).toBe(GATE_NODES[0]);
  });

  it('notifies subscribers on node change', () => {
    let notifiedState = null;
    const unsub = subscribeNodeChanges((state) => {
      notifiedState = state;
    });

    setActiveBoothNode(BOOTH_NODES[1]);
    expect(getActiveBoothNode()).toBe(BOOTH_NODES[1]);
    expect(notifiedState?.boothNode).toBe(BOOTH_NODES[1]);

    // Reset back
    setActiveBoothNode(BOOTH_NODES[0]);
    unsub();
  });

  it('automatically injects Idempotency-Key on POST requests', async () => {
    let capturedConfig = null;
    const mockAxiosInstance = vi.fn().mockImplementation((config) => {
      capturedConfig = config;
      return Promise.resolve({ data: { success: true } });
    });
    mockAxiosInstance.interceptors = {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    };

    axios.create = vi.fn().mockReturnValue(mockAxiosInstance);

    await resilientRequest({ method: 'POST', url: '/api/tickets/issue', data: {} });

    expect(capturedConfig).toBeDefined();
    expect(capturedConfig.headers['Idempotency-Key']).toMatch(/^idem-\d+/);
  });

  it('fails over to next peer node when current node encounters network error', async () => {
    let attemptCount = 0;
    const mockAxiosInstance = vi.fn().mockImplementation(() => {
      attemptCount++;
      if (attemptCount === 1) {
        // First node fails with Network Error
        return Promise.reject(new Error('Network Error'));
      }
      // Second peer succeeds!
      return Promise.resolve({ data: { success: true, fromNode: 'B2' } });
    });
    mockAxiosInstance.interceptors = {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    };

    axios.create = vi.fn().mockReturnValue(mockAxiosInstance);

    const res = await resilientRequest({ method: 'GET', url: '/api/events' });

    expect(res.data.success).toBe(true);
    expect(attemptCount).toBe(2);
  });
});
