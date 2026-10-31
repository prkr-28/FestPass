# FestPass: Distributed Campus Event Ticketing & Entry Validation

[![Test Suite](https://img.shields.io/badge/tests-96%20passed-brightgreen.svg)](<>)
[![Lint Status](https://img.shields.io/badge/lint-0%20errors-brightgreen.svg)](<>)
[![Stages](<https://img.shields.io/badge/stages-100%25%20completed%20(6%2F6)-blue.svg>)](<>)
[![Node Version](https://img.shields.io/badge/node-20%2B-green.svg)](<>)

FestPass is a production-quality, fault-tolerant campus ticketing and physical entry validation system built by a team of 6 engineers across 6 stages. It solves the classic distributed double-spend, ticket overselling, and concurrent physical entry problems in high-density campus festivals—even during complete network partitions and offline gate operations.

---

## 🏛️ System Architecture

FestPass runs a 6-node heterogeneous distributed cluster locally using a single codebase configured by environment variables. Each node maintains its own independent SQLite database file (`data/<NODE_ID>.db`) to faithfully simulate physically isolated machines with shared-nothing storage:

```
                          [ React 18 Web Portals & Scanner ]
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   ▼                                           ▼
      [ BOOTH NODES: B1, B2, B3 ]                 [ GATE NODES: G1, G2, G3 ]
      (Ports 4001, 4002, 4003)                    (Ports 4004, 4005, 4006)
      • Holds Ed25519 Private Key                 • Holds Ed25519 Public Key
      • Generates 64-bit Snowflake IDs            • Verifies Signatures Offline (<1ms)
      • Partitioned Quota Oversell Prevention     • Distributed Quorum Consensus (2/3)
      • Multi-Master State Machine Replication    • CRDT Conflict Resolution Engine
```

### Node Cluster Layout

| Node ID  | Role    | Port   | Database Path | Cryptographic Key | Primary Responsibilities                          |
| :------- | :------ | :----- | :------------ | :---------------- | :------------------------------------------------ |
| **`B1`** | `booth` | `4001` | `data/B1.db`  | Private Key       | Sells tickets, manages quota slice, gossips state |
| **`B2`** | `booth` | `4002` | `data/B2.db`  | Private Key       | Sells tickets, manages quota slice, gossips state |
| **`B3`** | `booth` | `4003` | `data/B3.db`  | Private Key       | Sells tickets, manages quota slice, gossips state |
| **`G1`** | `gate`  | `4004` | `data/G1.db`  | Public Key        | Scans tickets, quorum consensus, offline fallback |
| **`G2`** | `gate`  | `4005` | `data/G2.db`  | Public Key        | Scans tickets, quorum consensus, offline fallback |
| **`G3`** | `gate`  | `4006` | `data/G3.db`  | Public Key        | Scans tickets, quorum consensus, offline fallback |

---

## ⚡ Distributed Systems Fundamentals

1. **64-bit Snowflake Unique IDs**: K-ordered BigInt IDs combining custom epoch timestamp, node identifier, and sequence counter with physical clock drift protections ([`packages/shared/src/snowflake.js`](file:///packages/shared/src/snowflake.js)).
2. **Hybrid Logical Clocks (HLC)**: Monotonically increasing causal timestamps $(l, c, \text{nodeId})$ bounding physical wall-clock drift and providing deterministic distributed ordering ([`packages/shared/src/hlc.js`](file:///packages/shared/src/hlc.js)).
3. **Asymmetric Ticket Tokens (Ed25519)**: Tokens formatted as `FP1.<ticketId>.<eventId>.<signatureBase64url>`. Gates verify tickets offline in $<1\text{ms}$ without network access, while booths retain exclusive signing capabilities ([`packages/shared/src/tokens.js`](file:///packages/shared/src/tokens.js)).
4. **Capacity Quota Partitioning**: Prevents ticket overselling without distributed locks or inter-booth coordination. Supports dynamic quota borrowing across peers ([`apps/server/src/services/eventService.js`](file:///apps/server/src/services/eventService.js)).
5. **Distributed Gate Quorum Consensus**: Majority claim protocol ($2/3$ gates) preventing concurrent double-scans at different gates at the exact same physical millisecond ([`apps/server/src/services/gateService.js`](file:///apps/server/src/services/gateService.js)).
6. **State-Machine CRDT Reconciliation**: Deterministic post-partition resolution ordering concurrent offline check-ins by earliest HLC, logging loser duplicates, and flagging fraud alerts ([`apps/server/src/services/crdtEngine.js`](file:///apps/server/src/services/crdtEngine.js)).
7. **Failure Detector & Gossip Protocol**: Heartbeat monitoring transitioning nodes between `ALIVE`, `SUSPECT`, and `DEAD`, with anti-entropy operation log replication ([`apps/server/src/services/failureDetector.js`](file:///apps/server/src/services/failureDetector.js)).
8. **Resilient Client Failover**: Multi-node failover client with automatic `Idempotency-Key` injection to guarantee zero duplicate requests during network glitches ([`apps/web/src/api/client.js`](file:///apps/web/src/api/client.js)).

---

## 🚀 Quickstart Guide

### 1. Prerequisites

- Node.js 20+ (Node 22 / 24 tested)
- npm 10+

### 2. Installation & Setup

```bash
# Clone and install dependencies
git clone <repo-url>
cd FestPass
npm install

# Generate Ed25519 cryptographic keypair and seed SQLite databases
npm run keygen
npm run seed
```

**Default Test Accounts (from `npm run seed`):**

- **Admin**: `admin@campus.edu` / `AdminPass123!`
- **Booth Staff**: `booth1@campus.edu`, `booth2@campus.edu` / `BoothPass123!`
- **Gate Staff**: `gate1@campus.edu`, `gate2@campus.edu` / `GatePass123!`

### 3. Start the 6-Node Server Cluster

```bash
npm run cluster
```

_Starts B1 (4001), B2 (4002), B3 (4003), G1 (4004), G2 (4005), and G3 (4006) concurrently with color-coded logs._

### 4. Start the Web Application

In a second terminal:

```bash
npm run dev -w apps/web
```

Open **[http://localhost:5173](http://localhost:5173)** in your browser.

---

## 🖥️ Web Application Routes

| Path             | Description                                                                 | Access Role         |
| :--------------- | :-------------------------------------------------------------------------- | :------------------ |
| `/login`         | Authentication portal with viva demo quick-preset buttons                   | Public              |
| `/admin`         | Live sales KPIs, quota bar charts, and real-time Socket.IO stream           | Admin               |
| `/admin/events`  | Event CRUD, capacity partitioning, and quota status                         | Admin               |
| `/admin/tickets` | Searchable ticket registry, status glow, and revocation modal               | Admin               |
| `/admin/cluster` | Live node topology, replication lag, chaos injection & double scan demo     | Admin               |
| `/booth`         | POS sales form for single/group passes with high-res QR generation & print  | Booth Staff / Admin |
| `/gate`          | Full-screen camera QR scanner (`html5-qrcode`) with IndexedDB offline queue | Gate Staff / Admin  |
| `/my-ticket`     | Public attendee holographic pass with dynamic verification status           | Public              |

---

## 🔬 Live Demonstration & Benchmark Scripts

### 1. Concurrent Double-Scan Invariant

Fires the same ticket simultaneously at Gate G1 and Gate G2:

```bash
npm run demo:doublescan
```

_Verdict: Exactly 1 scan accepted via quorum consensus; exactly 1 rejected as duplicate._

### 2. Network Partition & CRDT Conflict Resolution

Simulates isolated gates accepting scans offline, heals partition, and reconciles via HLC:

```bash
npm run demo:partition
```

### 3. Mathematical Scenario Proof (100 Trials)

Proves the zero double-spend theorem across 100 trials of 3 concurrent gate scans:

```bash
npm run test:scenario
```

### 4. Latency Benchmark (Offline vs Online)

Benchmarks 100 offline local scans vs 100 online quorum scans, exporting `data/benchmark_results.json`:

```bash
npm run benchmark
```

### 5. High-Throughput Load Tests

```bash
npm run loadtest:sales   # Concurrent ticket sales throughput test
npm run loadtest:scan    # High-speed gate validation throughput test (>1000 scans/sec)
```

### 6. Node Process Supervisor (Port 4000)

Runs the supervisor daemon to start, kill, and restart nodes for live chaos demonstrations:

```bash
npm run supervisor
```

---

## 🧪 Testing & Code Quality

```bash
# Run entire Vitest unit & integration test suite (18 test files, 96 tests)
npm test

# Run ESLint (0 errors)
npm run lint

# Build frontend for production
npm run build -w apps/web
```

---

## 👥 Stage Ownership & Team Delivery

| Stage       | Focus Area                               | Deliverables                                                                                                                    | Owner    | Status   |
| :---------- | :--------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ | :------- | :------- |
| **Stage 1** | Foundation & Core Primitives             | Monorepo, SQLite schema, 64-bit Snowflake, HLC, Ed25519 token cryptography, API contract                                        | Member 1 | **DONE** |
| **Stage 2** | Auth, Events & Booth Sales               | JWT auth, events CRUD, booth ticket sales, static capacity quota partitioning, quota borrowing                                  | Member 2 | **DONE** |
| **Stage 3** | Replication & Membership                 | Peer gossip, heartbeat failure detector, State-Machine CRDT apply engine, anti-entropy sync, chaos hooks                        | Member 3 | **DONE** |
| **Stage 4** | Gate Validation & Quorum                 | Gate validation engine, majority ($2/3$) quorum claim protocol, offline mode fallback, conflict reconciliation hook             | Member 4 | **DONE** |
| **Stage 5** | Admin & Booth Frontend                   | Resilient multi-node failover client, Admin dashboard, event management, booth POS sales UI, attendee pass portal               | Member 5 | **DONE** |
| **Stage 6** | Gate Scanner, Chaos & Final Verification | Camera QR scanner, live cluster dashboard, node supervisor daemon, performance benchmarks, and comprehensive viva documentation | Member 6 | **DONE** |

---

## 📚 Examination & Viva Resources

- **[docs/DEMO_SCRIPT.md](file:///e:/FestPass/docs/DEMO_SCRIPT.md)**: 5–7 minute step-by-step viva presentation script for examiners.
- **[docs/REPORT_NOTES.md](file:///e:/FestPass/docs/REPORT_NOTES.md)**: Distributed systems theoretical architecture mapping and 20 faculty viva Q&As.
- **[docs/PROJECT_CONTEXT.md](file:///e:/FestPass/docs/PROJECT_CONTEXT.md)**: Comprehensive architectural specification and stage completion reports.
- **[docs/API_CONTRACT.md](file:///e:/FestPass/docs/API_CONTRACT.md)**: Full REST API and WebSocket contract specifications.
- **[docs/VALIDATION.md](file:///e:/FestPass/docs/VALIDATION.md)**: Detailed technical specification of Gate Quorum and CRDT resolution protocols.
