/**
 * Integration Tests: Chaos Hooks & Network Simulation (Stage 3)
 */

const request = require('supertest');
const { createApp } = require('../src/app');
const peerTransport = require('../src/services/peerTransport');

describe('Chaos & Simulation Hooks (/internal/chaos)', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    peerTransport.resetChaos();
  });

  afterEach(() => {
    peerTransport.resetChaos();
  });

  it('POST /internal/chaos sets partition rule and blocks traffic', async () => {
    // 1. Enable partition for node G2
    const res = await request(app).post('/internal/chaos').send({
      action: 'partition',
      targetNodeId: 'G2',
      enabled: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.currentState.partitions).toContain('G2');

    // 2. Outbound request to G2 should be blocked with PEER_UNREACHABLE
    await expect(peerTransport.sendRequest('G2', '/internal/gossip', { body: {} })).rejects.toThrow(
      /network partition/i
    );

    // 3. Inbound request from G2 should be rejected with 503 PEER_UNREACHABLE
    const inboundRes = await request(app)
      .post('/internal/gossip')
      .set('X-FestPass-Node-Id', 'G2')
      .send({
        originNodeId: 'G2',
        hlc: '1793370000000:0:G2',
        peers: [],
      });

    expect(inboundRes.status).toBe(503);
    expect(inboundRes.body.error.code).toBe('PEER_UNREACHABLE');
  });

  it('POST /internal/chaos with action=delay injects latency', async () => {
    const res = await request(app).post('/internal/chaos').send({
      action: 'delay',
      targetNodeId: 'B3',
      delayMs: 100,
      enabled: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.currentState.delays.B3).toBe(100);

    const start = Date.now();
    await peerTransport.checkInboundChaos('B3');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90);
  });

  it('POST /internal/chaos with action=drop drops messages', async () => {
    const res = await request(app).post('/internal/chaos').send({
      action: 'drop',
      targetNodeId: 'G3',
      dropRate: 1.0, // 100% drop rate
      enabled: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.currentState.dropRates.G3).toBe(1.0);

    await expect(peerTransport.checkInboundChaos('G3')).rejects.toThrow(/simulated packet drop/i);
  });

  it('POST /internal/chaos with action=reset restores normal network', async () => {
    // Inject partition and delay
    peerTransport.applyChaos({ action: 'partition', targetNodeId: 'G1', enabled: true });
    peerTransport.applyChaos({ action: 'delay', targetNodeId: 'G1', delayMs: 500, enabled: true });

    // Reset
    const res = await request(app).post('/internal/chaos').send({
      action: 'reset',
    });

    expect(res.status).toBe(200);
    expect(res.body.currentState.partitions).toHaveLength(0);
    expect(Object.keys(res.body.currentState.delays)).toHaveLength(0);

    // Should no longer throw
    await expect(peerTransport.checkInboundChaos('G1')).resolves.not.toThrow();
  });
});
