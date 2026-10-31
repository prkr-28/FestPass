# FestPass: Faculty Viva Demonstration Script (5–7 Minutes)

This step-by-step presentation script is designed for final project evaluation, faculty viva, or distributed systems lab examination. It demonstrates all core distributed computing concepts in action with exact commands, browser actions, and expected terminal outputs.

---

## Preparation Checklist

1. Open **three terminal windows** in the repo root `e:\FestPass`.
2. Open Google Chrome at `http://localhost:5173`.
3. Ensure initial databases and keys are seeded:
   ```bash
   npm run seed
   ```

---

## Demo Schedule Overview

| Minute | Phase | Focus Area | Technical Concept Demonstrated |
| :--- | :--- | :--- | :--- |
| **0:00 - 1:00** | Introduction & Architecture | 6-Node topology, storage isolation | Heterogeneous cluster, shared-nothing SQLite |
| **1:00 - 2:00** | Ticket Issuance & Quotas | Booth sales UI & atomic partitioning | Avoid overselling without inter-node locks |
| **2:00 - 3:30** | Double-Spend Prevention | Concurrent double scan at Gates G1 & G2 | Distributed Quorum Consensus (Majority 2/3) |
| **3:30 - 4:45** | Network Partition & Conflict | Offline scans & Anti-Entropy Sync | CRDT convergence, deterministic HLC ordering |
| **4:45 - 6:00** | Chaos Injection & Failover | Node failure, peer gossip, client failover | Heartbeat failure detection, resilient client |
| **6:00 - 7:00** | Performance & Viva Defense | High-throughput benchmark & Q&A | Autocannon load metrics, sub-2ms offline scans |

---

## Step 1: Cluster Startup & Topology (0:00 – 1:00)

### Action:
In **Terminal 1**, start the 6 autonomous server nodes:
```bash
npm run cluster
```

In **Terminal 2**, start the frontend application:
```bash
npm run dev -w apps/web
```

### Explaining to Faculty:
> *"FestPass runs 6 autonomous Node.js server processes from the same codebase, differentiated solely by environment variables. Nodes `B1`, `B2`, and `B3` are Booth nodes (ports 4001–4003) responsible for ticket issuing and quota management. Nodes `G1`, `G2`, and `G3` are Gate nodes (ports 4004–4006) responsible for entry validation. Each node maintains its own isolated SQLite file in `data/<NODE_ID>.db`, mimicking physically separate machines on campus."*

### Verify in Browser:
- Navigate to `http://localhost:5173/login`.
- Notice the **Viva Demo Quick-Login Presets**: Admin, Booth Staff (B1), Gate Staff (G1).
- Click **Admin Preset** (`admin@campus.edu`) and click **Sign In**.

---

## Step 2: Quota Partitioning & Ticket Issuance (1:00 – 2:00)

### Action:
1. In the Web UI, go to **Events** (`/admin/events`).
2. Click **+ Create Event**:
   - Name: `Campus Symphony 2026`
   - Venue: `University Auditorium`
   - Capacity: `300`
   - Price: `$25`
   - Status: `On Sale`
3. Click **Create & Partition Quota**.

### Explaining to Faculty:
> *"When capacity 300 was created, FestPass automatically partitioned the total capacity across booth nodes: B1 receives 100, B2 receives 100, B3 receives 100. Each booth can now sell up to its allocated quota atomically in local transactions without requiring distributed locks or synchronous inter-booth coordination. This achieves zero overselling with maximum availability."*

4. Switch to **Booth Sales** (`/booth`):
   - Select `Campus Symphony 2026`.
   - Issue a ticket to `Alice Student` (`alice@campus.edu`).
   - Click **Complete Cash Sale & Issue Pass**.
   - Show the generated ticket pass with the high-resolution QR code containing the cryptographically signed Ed25519 token:
     `FP1.<SnowflakeTicketId>.<EventId>.<Ed25519SignatureBase64Url>`.

---

## Step 3: Concurrent Double-Scan Prevention (2:00 – 3:30)

### Action:
In **Terminal 3**, execute the live concurrent double-scan proof script:
```bash
npm run demo:doublescan
```

### Expected Terminal Output:
```
================================================================================
 FESTPASS CONCURRENT DOUBLE-SCAN DEMONSTRATION
 Distributed Gate Quorum Consensus & Double-Spend Prevention
================================================================================

[1/2] Issuing Ed25519-signed ticket for event "Campus Symphony 2026"...
  ✓ Ticket Generated!
    Ticket ID: 242172536882728960
    Token:     FP1.242172536882728960.2421623411588...

[2/2] Firing simultaneous scans across Gate G1 and Gate G2...

--------------------------------------------------------------------------------
 SCAN ATTEMPT RESULTS
--------------------------------------------------------------------------------
  Gate 1 (G1)     : ✓ ACCEPTED                         (12ms latency)
  Gate 2 (G2)     : ✗ REJECTED (DUPLICATE BLOCKED)     (14ms latency)
--------------------------------------------------------------------------------
 FINAL VERDICT:
  ✓ CONSENSUS SUCCESS: EXACTLY 1 SCAN ACCEPTED, 1 DUPLICATE REJECTED!
  Distributed Gate Quorum consensus successfully prevented double entry.
================================================================================
```

### Explaining to Faculty:
> *"Even though both gate nodes received the request at the exact same physical millisecond, the Distributed Quorum Consensus protocol required majority consensus (2 out of 3 gates). Gate G1 acquired the ticket claim grant with an earlier Hybrid Logical Clock (HLC). When Gate G2 requested quorum, peer gates detected the active grant and rejected Gate G2's claim as a duplicate, completely preventing fraudulent double-entry."*

---

## Step 4: Offline Validation & Network Partition Healing (3:30 – 4:45)

### Action:
In **Terminal 3**, run the network partition and conflict resolution demonstration:
```bash
npm run demo:partition
```

### Expected Terminal Output:
```
================================================================================
 FESTPASS NETWORK PARTITION & CONFLICT RESOLUTION
 CRDT Reconciliation, Deterministic HLC Ordering & Fraud Detection
================================================================================

[1/4] Ticket issued: ID=t_part_1793428039459
      Status: valid, Token: FP1.t_part_1793428039459.2421623...

[2/4] Network Partition Active: Gate G1 and Gate G2 isolated
      - Attendee arrives at Gate G1 at T1
      - Duplicate attendee arrives at Gate G2 at T2 (T2 > T1)

[3/4] Partition Heals! Reconciling operations via CRDT engine...

[4/4] CRDT Reconciliation Complete! Analyzing results:
--------------------------------------------------------------------------------
  Gate G1  : [WINNER - ACCEPTED] | HLC: 1793428039461:0:G1 | Resolved: false
  Gate G2  : [LOSER - REJECTED DUPLICATE] | HLC: 1793428039462:1:G2 | Resolved: true
--------------------------------------------------------------------------------
  Ticket Status:      USED
  Fraud Alert Flag:   ACTIVE (FLAGGED)
  Conflicts Logged:   1 conflict record(s) in database

  Conflict Details:
    Winner Checkin ID: chk_g1_1793428039462 (G1 at HLC 1793428039461:0:G1)
    Loser Checkin ID:  chk_g2_1793428039463 (G2 at HLC 1793428039462:1:G2)
    Resolution Reason: Offline concurrent check-in conflict. Winner had earlier HLC timestamp.
--------------------------------------------------------------------------------
  ✓ CONFLICT RESOLUTION SUCCESS:
  Deterministic HLC comparison resolved concurrent offline scans correctly.
  Earlier HLC won entry, duplicate was rejected, and fraud was flagged.
================================================================================
```

### Explaining to Faculty:
> *"During temporary campus network blackouts, gates operate under the AP (High Availability) mode of the CAP theorem. Using Ed25519 asymmetric cryptography, gate staff verify tickets 100% offline. If fraudulent clones are scanned at two disconnected gates, both accept tentatively. Once the network reconnects, the State-Machine CRDT engine orders the events using Hybrid Logical Clocks: the earlier logical timestamp wins entry, the loser is retroactively flagged as duplicate, a fraud alert is marked on the ticket, and the incident is broadcast in real time to the admin console."*

---

## Step 5: Live Cluster Dashboard, Chaos Injection & Failover (4:45 – 6:00)

### Action:
1. In the browser, navigate to the **Cluster Dashboard** (`/admin/cluster`).
2. Show the real-time topology of all 6 nodes:
   - Green status indicators for `B1`, `B2`, `B3`, `G1`, `G2`, `G3`.
   - Live HLC counters, database paths, and active replication outboxes.
3. In the **Chaos Engineering Panel**:
   - Select Node `B1` and click **Simulate Crash / Kill Process**.
   - Observe in the dashboard: within 500ms, the Heartbeat Failure Detector marks `B1` as `SUSPECT` then `DEAD`.
   - Now try navigating to **Booth Sales**: the frontend API client automatically fails over to `B2` (port 4002) with zero downtime and continues issuing tickets.
   - Return to the Cluster Dashboard and click **Restart B1**: the failure detector transitions `B1` back to `ALIVE`, and anti-entropy sync brings its database up to date.

---

## Step 6: Concurrency Invariant & Throughput Proofs (6:00 – 7:00)

### Action:
In **Terminal 3**, run the 100-trial mathematical invariant proof:
```bash
npm run test:scenario
```

### Explaining Output:
- 100 trials of 3 simultaneous gate scans (300 scans total).
- Passed: 100/100 (100.0%).
- Failed: 0.
- Average quorum latency: ~15ms.

In **Terminal 3**, display the latency comparison benchmark:
```bash
npm run benchmark
```
- Offline local signature scan: **0.82 ms** (5.3x faster).
- Online quorum consensus scan: **4.37 ms**.

---

## Summary for Examiners

1. **CAP Theorem**: Seamless balance between CP (Strict Quorum Consensus online) and AP (Autonomous Offline Validation with CRDT reconciliation).
2. **Deterministic Ordering**: Hybrid Logical Clocks eliminate wall-clock drift issues and provide strict causal consistency.
3. **Zero Single Point of Failure**: Full client failover, peer failure detection, and multi-master state replication.
