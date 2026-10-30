# Replication Layer Architecture (Stage 3)

## 1. Overview & Protocol Architecture

FestPass operates as a multi-master distributed ticketing system spanning **6 nodes**:

- **3 Booth Nodes** (`B1`, `B2`, `B3` on ports 4001–4003) responsible for concurrent offline/online ticket sales.
- **3 Gate Nodes** (`G1`, `G2`, `G3` on ports 4004–4006) responsible for attendee check-ins and admission validation.

Replication in FestPass is designed around an **AP (Available / Partition-Tolerant)** model under the CAP theorem, delivering **eventual consistency** with deterministic Conflict-Free Replicated Data Type (CRDT) semantics backed by **Hybrid Logical Clocks (HLC)**.

### Hybrid Push-Pull Replication Engine

The engine combines two complementary strategies:

1. **Eager Push Replication**:
   - Every local state change generates an `op_log` record with an monotonic HLC timestamp (`${physicalMs}:${counter}:${nodeId}`).
   - The writing node immediately broadcasts the serialized operation to all known healthy/alive peers (`POST /internal/replicate`).
   - If a peer is temporarily unreachable or dead, the operation is persisted into the local SQLite `outbox` table with exponential backoff retry metadata.
2. **Periodic Pull Anti-Entropy Synchronization**:
   - Every 5 seconds (configurable via `antiEntropyIntervalMs`), each node computes its local **Version Vector** (the maximum HLC seen for each origin node).
   - The node exchanges version vectors with alive peers (`POST /internal/sync`).
   - The peer responds with its version vector and any missing `op_log` entries newer than the requester's vector (up to batch limit 100).
   - This guarantees that offline nodes, partitioned nodes, or freshly booted nodes catch up seamlessly.

```
       +-------------------------------------------------------------+
       |                        Client Write                         |
       +-------------------------------------------------------------+
                                      |
                                      v
       +-------------------------------------------------------------+
       |               Local SQLite Transaction                      |
       |  1. Apply Local Model Write                                 |
       |  2. HLC tick() -> Assign op_id & hlc                        |
       |  3. Append to op_log                                        |
       +-------------------------------------------------------------+
                                      |
                     +----------------+----------------+
                     |                                 |
                     v                                 v
        [Push Replication Task]            [Pull Anti-Entropy Loop]
       Broadcast to Alive Peers           Exchange Version Vectors
       POST /internal/replicate           POST /internal/sync
                     |                                 |
          +----------+----------+                      |
          | Success             | Fail                 |
          v                     v                      v
      (Done)             Buffer into             Fetch & Apply
                         `outbox` table          Missing Op Batches
                         (Retry with backoff)    via CRDT Engine
```

---

## 2. Membership & Failure Detection

Failure detection uses a gossip-based heartbeat protocol running every 3 seconds (`heartbeatIntervalMs`):

- **Gossip Message (`POST /internal/gossip`)**:
  - Transmits sender's `nodeId`, `role`, current `hlc`, `timestamp`, and state of known peers.
- **State Machine**:
  - `ALIVE` / `HEALTHY`: Heartbeat received within `suspectTimeoutMs` (default 6,000ms).
  - `SUSPECT`: No heartbeat for > 6,000ms. Node is suspected down; push attempts still route to outbox.
  - `DEAD`: No heartbeat for > `deadTimeoutMs` (default 15,000ms).
  - `AUTO-RECOVERY`: Any valid incoming message (gossip, replication, sync) immediately transitions the peer back to `ALIVE`.
- **Database Persistence**:
  - Peer statuses and `last_seen` timestamps are updated transactionally in the `peers` SQLite table.
  - Changes trigger Socket.IO `cluster:update` broadcasts for real-time frontend observability.

```
  +--------------+    missed heartbeat > 6s     +--------------+
  |    ALIVE     | ---------------------------> |   SUSPECT    |
  |  (HEALTHY)   | <--------------------------- |              |
  +--------------+        heartbeat received    +--------------+
         ^                                             |
         |                                             | missed heartbeat > 15s
         |            heartbeat received               v
         +------------------------------------- +--------------+
                                                |     DEAD     |
                                                +--------------+
```

---

## 3. CRDT Convergence & Apply Semantics

All incoming replication entries (`POST /internal/replicate` and `POST /internal/sync`) are processed deterministically by `crdtEngine.js`.

### 1. Inbound HLC Clock Synchronization

Every incoming message runs `hlcService.receive(incomingHlc)`. This satisfies Lamport's clock condition and guarantees that subsequent operations on the receiving node strictly exceed both the local clock and the remote origin clock.

### 2. Idempotency Guarantee

The engine checks `op_log` by `op_id`. If `op_id` already exists locally, the operation is skipped immediately without re-executing writes.

### 3. Per-Operation CRDT Resolution Rules

| Operation Type       | CRDT Abstraction                             | Resolution Rule                                                                                                                                                                             |
| :------------------- | :------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EVENT_UPSERT`       | **Last-Writer-Wins Register (LWW-Register)** | Compares `incoming.hlc` against the existing event's `updated_hlc`. The write with the higher HLC wins. If identical HLC, tie-break deterministically by `nodeId`.                          |
| `TICKET_ISSUED`      | **Add-Only Set (G-Set)**                     | Ticket IDs are globally unique 64-bit Snowflakes containing node IDs and timestamps. An issue is inserted idempotently. If the ticket exists and is `REVOKED`, the revocation is preserved. |
| `TICKET_REVOKED`     | **Tombstone Wins (Observed-Remove Set)**     | Revocation always trumps `VALID` status. Even if a delayed `TICKET_ISSUED` arrives after a `TICKET_REVOKED`, the ticket remains `REVOKED`.                                                  |
| `BOOTH_QUOTA_ADJUST` | **PN-Counter / Delta CRDT**                  | Booth quotas adjust via signed deltas (`delta` field) applied directly to `events.booth_quotas[nodeId]`, ensuring concurrent quota adjustments across booths commute.                       |
| `CHECKIN_RECORDED`   | **Stage 4 Extension Hook**                   | Documented extension hook provided in `crdtEngine.applyCheckinOp()`. Stage 4 will plug in gate quorum reconciliation rules.                                                                 |

---

## 4. Peer Transport & Chaos Simulation Layer

All inter-node HTTP communication (`gossip`, `replicate`, `sync`, and gate quorum) traverses `peerTransport.js`.

Chaos controls can be injected dynamically via `POST /internal/chaos` or configured globally via `global.__festpass_chaos`:

```bash
# Example: Partition Node B1 from B2 and B3
curl -X POST http://localhost:4001/internal/chaos \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "partition",
    "targetNode": "b2",
    "blockedPeers": ["b2", "b3"]
  }'
```

Supported Chaos Actions:

- **`partition`**: Simulates bidirectional or unidirectional network partitions. Requests to blocked peers immediately reject with HTTP 503 (`NETWORK_PARTITION`). Inbound requests from blocked peers are rejected via middleware.
- **`delay`**: Injects artificial latency (`durationMs`) using asynchronous sleep before socket transmission.
- **`drop`**: Randomly drops outbound or inbound HTTP requests at a configured percentage rate (`dropRate` / `percentage`).
- **`reset`**: Clears all active chaos simulation rules on the target node.

---

## 5. Architectural Trade-offs & Discussion

### A. CAP Theorem Choice: AP over CP

FestPass chooses **AP (High Availability with Eventual Consistency)** rather than CP (Consistent under Partitions):

- **Campus Event Realities**: Gates and ticketing booths are distributed across campus venues with intermittent Wi-Fi and mobile hotspot connectivity.
- A CP system (e.g., Raft, Paxos, 2PC) would reject ticket sales at Booth 2 if a network hiccup isolated it from the majority. Under AP, Booths continue selling tickets offline out of their local pre-allocated quotas (Snowflake IDs prevent collisions, and quota reservations prevent overselling).
- When connectivity resumes, anti-entropy sync guarantees cluster-wide convergence in seconds.

### B. Hybrid Logical Clocks (HLC) vs. Physical NTP vs. Vector Clocks

1. **Why not NTP / Wall-Clock timestamps?**
   - Physical clocks on commodity hardware drift by tens to hundreds of milliseconds. Clock skew causes classic Last-Writer-Wins anomalies: a causally earlier update with a fast clock overwrites a later update with a slow clock.
2. **Why not pure Vector Clocks?**
   - Vector clocks track exact causality without clock skew, but their message size scales with cluster size $O(N)$ and they do not provide total ordering (concurrent writes yield unresolvable concurrent branches that require manual application-level resolution).
3. **Why Hybrid Logical Clocks (Kulkarni et al., 2014)?**
   - HLC combines physical time $l$ (tracking NTP within a bounded drift $\epsilon$) with a logical counter $c$.
   - **Properties guaranteed**:
     - Causality tracking: If $e_1 \to e_2$, then $hlc(e_1) < hlc(e_2)$.
     - Total ordering: Tie-breaking by node ID produces an unambiguous ordering for every event in the system.
     - Bounded storage: Serialized as a compact string `${physicalMs}:${counter}:${nodeId}`.

### C. Outbox Pattern vs. Distributed 2PC

- In-memory message queues lose messages if a node crashes before delivery.
- Traditional Two-Phase Commit (2PC) blocks local writes if any peer is down, violating availability.
- FestPass writes the operation to the local SQLite `op_log` and buffers delivery failures in the SQLite `outbox` table within the same ACID transaction boundary. When a dead node restarts, anti-entropy sync pulls the missing range directly from `op_log`, rendering message loss impossible.

---

## 6. Convergence Verification

The verification script `npm run verify:convergence` inspects all node databases in `apps/server/data/*.db`, computes cryptographic MD5 hashes of canonicalized rows across `events` and `tickets`, and reports synchronization status:

```bash
npm run verify:convergence
```

Sample output:

```
FestPass Multi-Node Convergence Check
================================================================================
Node       Events Hash                      Tickets Hash                     Events Count  Tickets Count
--------------------------------------------------------------------------------
node_b1    d41d8cd98f00b204e9800998ecf8427e 0a78939c36274e1dbbe32a0c7104f762 1             12
node_b2    d41d8cd98f00b204e9800998ecf8427e 0a78939c36274e1dbbe32a0c7104f762 1             12
node_b3    d41d8cd98f00b204e9800998ecf8427e 0a78939c36274e1dbbe32a0c7104f762 1             12
node_g1    d41d8cd98f00b204e9800998ecf8427e 0a78939c36274e1dbbe32a0c7104f762 1             12
node_g2    d41d8cd98f00b204e9800998ecf8427e 0a78939c36274e1dbbe32a0c7104f762 1             12
node_g3    d41d8cd98f00b204e9800998ecf8427e 0a78939c36274e1dbbe32a0c7104f762 1             12
--------------------------------------------------------------------------------
Events Table Status:  ✓ CONVERGED
Tickets Table Status: ✓ CONVERGED
================================================================================
```
