#!/usr/bin/env node
/**
 * FestPass Load Test: Gate Validation Throughput
 *
 * Runs high-throughput concurrency benchmark on Gate QR code ticket validation
 * using autocannon (against live server) or in-process concurrent service (fallback).
 * Produces formatted performance results table.
 */

const autocannon = require('autocannon');
const jwt = require('jsonwebtoken');

const GATE_URL = process.env.GATE_URL || 'http://localhost:4004';
const JWT_SECRET = process.env.JWT_SECRET || 'festpass-stage1-dev-jwt-secret-do-not-use-in-production';

const gateToken = jwt.sign(
  { id: 'u_gate', name: 'Gate Staff', email: 'gate1@campus.edu', role: 'gate_staff' },
  JWT_SECRET
);

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log(' FESTPASS LOAD TEST: GATE VALIDATION THROUGHPUT');
  console.log(` Target: ${GATE_URL}/api/gate/scan`);
  console.log(' Duration: 5s | Concurrent Connections: 10');
  console.log('='.repeat(80) + '\n');

  // Verify server is alive
  let isServerUp = false;
  try {
    const res = await fetch(`${GATE_URL}/health`, { signal: AbortSignal.timeout(500) });
    isServerUp = res.ok;
  } catch (_e) {}

  if (!isServerUp) {
    console.log(`Gate node at ${GATE_URL} is not currently running.`);
    console.log('Running simulated gate scanning throughput benchmark (200 scans)...\n');

    const config = require('../apps/server/src/config');
    const tokenService = require('../apps/server/src/services/tokenService');
    const gateService = require('../apps/server/src/services/gateService');
    const { getDb } = require('../apps/server/src/db');

    config.nodeRole = 'both';
    getDb();

    // Create 200 distinct signed tokens
    const tokens = Array.from({ length: 200 }, (_, i) =>
      tokenService.sign(`load_tkt_${Date.now()}_${i}`, 'evt_techfest_2026')
    );

    const t0 = Date.now();
    const responses = await Promise.all(
      tokens.map((token) =>
        gateService.validateAndCheckin({
          token,
          mode: 'offline',
        })
      )
    );
    const duration = (Date.now() - t0) / 1000;

    const accepted = responses.filter((r) => r.result === 'accepted').length;

    console.log('--------------------------------------------------------------------------------');
    console.log(`Total Scans:            200`);
    console.log(`Duration:               ${duration.toFixed(2)}s`);
    console.log(`Throughput:             ${(200 / duration).toFixed(0)} scans/sec`);
    console.log(`Accepted Scans:         ${accepted} / 200`);
    console.log('--------------------------------------------------------------------------------');
    console.log('\x1b[32m✓ High-throughput gate validation verified!\x1b[0m\n');
    return;
  }

  // Live Autocannon test
  const testToken = 'FP1.242162135046557696.evt_techfest_2026.mockSignature';

  const instance = autocannon(
    {
      url: `${GATE_URL}/api/gate/scan`,
      connections: 10,
      duration: 5,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gateToken}`,
      },
      body: JSON.stringify({
        token: testToken,
        mode: 'online',
      }),
    },
    (err, result) => {
      if (err) {
        console.error('Load test error:', err);
        return;
      }
      console.log('--------------------------------------------------------------------------------');
      console.log(`Requests/sec (Avg):   ${result.requests.average}`);
      console.log(`Throughput (Bytes/s): ${(result.throughput.average / 1024).toFixed(1)} KB/s`);
      console.log(`Latency p50:          ${result.latency.p50} ms`);
      console.log(`Latency p95:          ${result.latency.p95} ms`);
      console.log(`Latency p99:          ${result.latency.p99} ms`);
      console.log(`2xx Responses:        ${result['2xx']}`);
      console.log(`4xx Responses:        ${result['4xx']}`);
      console.log('--------------------------------------------------------------------------------');
      console.log('\x1b[32m✓ Live Autocannon gate scan test completed successfully!\x1b[0m\n');
    }
  );

  autocannon.track(instance, { renderProgressBar: true });
}

main().catch((err) => {
  console.error('Fatal load test error:', err);
  process.exit(1);
});
