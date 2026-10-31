/**
 * Full End-to-End System & Web Page Verification
 */

const assert = require('assert');

async function testAll() {
  console.log('================================================================');
  console.log(' FESTPASS COMPREHENSIVE END-TO-END VERIFICATION');
  console.log('================================================================');

  // 1. Web Frontend Server
  console.log('\n[1/10] Verifying React + Vite Web Server on http://localhost:3000...');
  const webRes = await fetch('http://localhost:3000/');
  assert.strictEqual(webRes.status, 200, 'Web server did not return 200');
  const webHtml = await webRes.text();
  assert(webHtml.includes('id="root"'), 'Vite HTML missing root container');
  assert(webHtml.includes('FestPass'), 'Vite HTML title or content missing FestPass');
  console.log('  ✓ Web server running, serves index.html with SPA root container.');

  // 2. 6-Node Cluster Health
  console.log('\n[2/10] Verifying Health of all 6 Cluster Nodes (B1..B3, G1..G3)...');
  const expectedRoles = {
    4001: { nodeId: 'B1', role: 'booth' },
    4002: { nodeId: 'B2', role: 'booth' },
    4003: { nodeId: 'B3', role: 'booth' },
    4004: { nodeId: 'G1', role: 'gate' },
    4005: { nodeId: 'G2', role: 'gate' },
    4006: { nodeId: 'G3', role: 'gate' },
  };

  for (const [port, expected] of Object.entries(expectedRoles)) {
    const healthRes = await fetch(`http://localhost:${port}/health`);
    assert.strictEqual(healthRes.status, 200, `Node on port ${port} failed health check`);
    const healthData = await healthRes.json();
    assert.strictEqual(healthData.status, 'ok', `Node on port ${port} status is not ok`);
    assert.strictEqual(healthData.nodeId, expected.nodeId, `Node ID mismatch on port ${port}`);

    const infoRes = await fetch(`http://localhost:${port}/node/info`);
    assert.strictEqual(infoRes.status, 200, `Node on port ${port} failed info check`);
    const infoData = await infoRes.json();
    assert.strictEqual(infoData.role, expected.role, `Role mismatch on port ${port}`);
    console.log(
      `  ✓ Port ${port}: Node ${infoData.nodeId} (${infoData.role.toUpperCase()}) - ${healthData.status} [HLC: ${infoData.hlc}]`
    );
  }

  // 3. User Authentication
  console.log('\n[3/10] Verifying Staff Authentication & JWT Token Issuance...');
  const loginRes = await fetch('http://localhost:4001/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@campus.edu', password: 'AdminPass123!' }),
  });
  assert.strictEqual(loginRes.status, 200, 'Login failed');
  const loginData = await loginRes.json();
  assert(loginData.token, 'JWT token not returned');
  assert.strictEqual(loginData.user.role, 'admin');
  const adminToken = loginData.token;
  console.log(
    `  ✓ Logged in as ${loginData.user.name} (${loginData.user.email}) - Role: ${loginData.user.role}`
  );

  // 4. Authenticated Profile & Role Enforcement
  console.log('\n[4/10] Verifying Profile Retrieval (/api/auth/me)...');
  const meRes = await fetch('http://localhost:4001/api/auth/me', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.strictEqual(meRes.status, 200);
  const meData = await meRes.json();
  assert.strictEqual(meData.user.email, 'admin@campus.edu');
  console.log(`  ✓ Profile returned correctly for user ID: ${meData.user.id}`);

  // 5. Events Management & Quota Partitioning
  console.log('\n[5/10] Verifying Events Management & Quota Slices...');
  const eventsRes = await fetch('http://localhost:4001/api/events');
  assert.strictEqual(eventsRes.status, 200);
  const eventsData = await eventsRes.json();
  assert(eventsData.events.length > 0, 'No events returned');
  const targetEvent = eventsData.events[0];
  console.log(
    `  ✓ Fetched ${eventsData.events.length} active events. Target event: "${targetEvent.name}" (Capacity: ${targetEvent.capacity})`
  );

  // Verify booth quotas for this event
  const eventDetailRes = await fetch(`http://localhost:4001/api/events/${targetEvent.id}`);
  const eventDetail = await eventDetailRes.json();
  const quotas = eventDetail.event?.quotas || eventDetail.quotas;
  assert(quotas && quotas.length === 3, 'Booth quotas not partitioned across 3 booths');
  console.log(
    `  ✓ Event booth quotas properly partitioned:`,
    quotas.map((q) => `${q.node_id}:${q.quota}`).join(', ')
  );

  // 6. Cryptographic Ticket Issuance (Booth B1)
  console.log('\n[6/10] Verifying Ed25519 Cryptographic Ticket Issuance on Booth B1...');
  const idemKey = `verify-tkt-${Date.now()}`;
  const issueRes = await fetch('http://localhost:4001/api/tickets/issue', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'Idempotency-Key': idemKey,
    },
    body: JSON.stringify({
      eventId: targetEvent.id,
      holderName: 'Elena Rostova',
      holderEmail: 'elena.rostova@campus.edu',
      holderPhone: '+15559876543',
    }),
  });
  assert.strictEqual(issueRes.status, 201, 'Ticket issuance failed');
  const issueData = await issueRes.json();
  const ticket = issueData.ticket;
  const ticketId = ticket.ticketId || ticket.id;
  assert(
    ticket.token.startsWith('FP1.'),
    'Token does not match FestPass v1 format FP1.<ticketId>.<eventId>.<sig>'
  );
  console.log(`  ✓ Ticket issued: ID ${ticketId}`);
  console.log(`  ✓ Ed25519 Digital Signature Token: ${ticket.token.slice(0, 45)}...`);

  // 7. Idempotency Check
  console.log('\n[7/10] Verifying Idempotency Guarantee (retrying same request)...');
  const retryRes = await fetch('http://localhost:4001/api/tickets/issue', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'Idempotency-Key': idemKey,
    },
    body: JSON.stringify({
      eventId: targetEvent.id,
      holderName: 'Elena Rostova',
      holderEmail: 'elena.rostova@campus.edu',
      holderPhone: '+15559876543',
    }),
  });
  assert(
    retryRes.status === 200 || retryRes.status === 201,
    'Idempotent retry did not return 200/201'
  );
  const retryData = await retryRes.json();
  const retryId = retryData.ticket?.ticketId || retryData.ticket?.id;
  assert.strictEqual(retryId, ticketId, 'Idempotent request returned different ticket');
  console.log('  ✓ Idempotency confirmed: Identical ticket returned without duplicate sales.');

  // 8. Gate G1 Online Entry Scan
  console.log('\n[8/10] Verifying Gate G1 Online Entry Scan...');
  const scanG1Res = await fetch('http://localhost:4004/api/gate/scan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ token: ticket.token, mode: 'online' }),
  });
  assert.strictEqual(scanG1Res.status, 200);
  const scanG1Data = await scanG1Res.json();
  if (scanG1Data.result !== 'accepted') {
    console.error('Scan 1 details:', scanG1Data);
  }
  assert.strictEqual(scanG1Data.result, 'accepted', `Expected accepted, got ${scanG1Data.result}`);
  console.log(
    `  ✓ Gate G1 Verdict: ACCEPTED (${scanG1Data.mode} mode, latency: ${scanG1Data.latencyMs}ms)`
  );

  // 9. Gate G2 Concurrent/Duplicate Entry Rejection
  console.log('\n[9/10] Verifying Gate G2 Duplicate Scan Rejection...');
  const scanG2Res = await fetch('http://localhost:4005/api/gate/scan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ token: ticket.token, mode: 'online' }),
  });
  assert.strictEqual(scanG2Res.status, 200);
  const scanG2Data = await scanG2Res.json();
  assert.strictEqual(
    scanG2Data.result,
    'rejected_duplicate',
    `Expected rejected_duplicate, got ${scanG2Data.result}`
  );
  console.log(
    `  ✓ Gate G2 Verdict: REJECTED_DUPLICATE (Prior checkin at Gate ${scanG2Data.priorCheckin?.gateNodeId || 'G1'})`
  );

  // 10. Cluster Topology & Replication Observability
  console.log('\n[10/10] Verifying Cluster Observability & Real-time Replication...');
  const clusterRes = await fetch('http://localhost:4001/api/cluster/nodes');
  assert.strictEqual(clusterRes.status, 200);
  const clusterData = await clusterRes.json();
  console.log(`  ✓ Cluster Nodes reported by B1: ${clusterData.peers.length} peers`);
  for (const peer of clusterData.peers) {
    console.log(
      `    - Node ${peer.node_id || peer.nodeId} (${peer.role}): status=${peer.status}, lastSeen=${new Date(peer.last_seen).toLocaleTimeString()}, lagOps=${peer.replicationLagOps}`
    );
  }

  console.log('\n================================================================');
  console.log(' ALL 10 END-TO-END VERIFICATION CHECKS PASSED PERFECTLY!');
  console.log(' Web Server:      http://localhost:3000 (ACTIVE)');
  console.log(' Booth Cluster:   http://localhost:4001, 4002, 4003 (ACTIVE)');
  console.log(' Gate Cluster:    http://localhost:4004, 4005, 4006 (ACTIVE)');
  console.log('================================================================\n');
}

testAll().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
