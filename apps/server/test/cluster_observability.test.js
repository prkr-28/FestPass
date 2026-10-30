/**
 * Integration Tests: Cluster Observability & Telemetry Endpoints (Stage 3)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { getDb } from '../src/db';

describe('Cluster Observability Endpoints', () => {
  let app;

  beforeEach(() => {
    app = createApp();
  });

  it('GET /cluster/nodes returns peer list with status, last_seen, and replication lag', async () => {
    const res = await request(app).get('/cluster/nodes');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.currentNode).toBeDefined();
    expect(res.body.currentNode.nodeId).toBeDefined();
    expect(res.body.currentNode.hlc).toBeDefined();

    expect(Array.isArray(res.body.peers)).toBe(true);
    if (res.body.peers.length > 0) {
      const peer = res.body.peers[0];
      expect(peer).toHaveProperty('node_id');
      expect(peer).toHaveProperty('status');
      expect(peer).toHaveProperty('last_seen');
      expect(peer).toHaveProperty('replicationLagOps');
      expect(peer).toHaveProperty('replicationLagMs');
    }
  });

  it('GET /api/cluster/nodes works identically under contract prefix', async () => {
    const res = await request(app).get('/api/cluster/nodes');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /cluster/replication returns version vector and outbox sizes', async () => {
    const res = await request(app).get('/cluster/replication');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.nodeId).toBeDefined();
    expect(res.body.hlc).toBeDefined();
    expect(res.body.versionVector).toBeDefined();
    expect(typeof res.body.versionVector).toBe('object');
    expect(res.body.outboxSizes).toBeDefined();
    expect(typeof res.body.outboxSizes).toBe('object');
    expect(typeof res.body.totalOperations).toBe('number');
  });

  it('GET /api/cluster/replication-status complies with API contract 7.2', async () => {
    const res = await request(app).get('/api/cluster/replication-status');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.totalOperations).toBeGreaterThanOrEqual(0);
  });
});
