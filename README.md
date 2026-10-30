# FestPass: Distributed Campus Event Ticketing & Entry Validation

FestPass is a high-availability, fault-tolerant campus ticketing system designed to prevent ticket overselling at sales booths and eliminate double-entry scans across physical gates—even in the presence of network partitions and offline gate operation.

> **Important**: Before contributing or developing subsequent stages, read [CONTEXT.md](file:///e:/FestPass/CONTEXT.md), [docs/PROJECT_CONTEXT.md](file:///e:/FestPass/docs/PROJECT_CONTEXT.md), and [docs/API_CONTRACT.md](file:///e:/FestPass/docs/API_CONTRACT.md).

---

## Architecture at a Glance

FestPass simulates a distributed 6-node campus infrastructure using a single codebase configured by environment variables. Each node maintains its own independent SQLite database file (`data/<NODE_ID>.db`) to mimic separate physical servers:

- **Sales Booths** (`B1`, `B2`, `B3` on ports 4001–4003): Sell tickets, manage partitioned quotas to prevent overselling, and hold the Ed25519 private signing key.
- **Entry Gates** (`G1`, `G2`, `G3` on ports 4004–4006): Scan and validate tickets using the Ed25519 public key. Supports offline validation and quorum-based distributed consensus.

```
       [ Web Clients / Scanner Apps ]
                     |
       +-------------+-------------+
       |                           |
[ Booth Nodes: B1, B2, B3 ]   [ Gate Nodes: G1, G2, G3 ]
(Ports 4001-4003)             (Ports 4004-4006)
- Holds Private Key           - Holds Public Key
- Issues Ed25519 Tokens       - Verifies Tokens (Offline OK)
- Partitioned Quotas          - Quorum Check-in & Conflict Log
```

---

## Core Distributed Concepts

- **64-bit Snowflake Unique IDs**: K-ordered, unique BigInt IDs combining custom epoch timestamps, node indices, and sequence counters with backward clock drift protection.
- **Hybrid Logical Clocks (HLC)**: Provides causal event ordering bounded by physical time, with deterministic node tie-breaking for distributed consensus.
- **Asymmetric Ticket Cryptography (Ed25519)**: Tokens formatted as `FP1.<ticketId>.<eventId>.<signatureBase64url>`. Gates verify tickets offline without network connectivity, while booths retain exclusive signing capabilities.
- **State Machine Replication & Gossip**: Peer heartbeats and anti-entropy log synchronization over an operation log (`op_log`).

---

## Quickstart

### Prerequisites

- Node.js 20+ (Node 24 recommended)
- npm 10+

### 1. Installation

Install all monorepo dependencies across `packages/shared`, `apps/server`, and `apps/web`:

```bash
npm install
```

### 2. Cryptographic Key Generation & Database Seed

Generate the Ed25519 keypair for ticket signing and offline verification. This creates `keys/ed25519-private.pem`, `keys/ed25519-public.pem`, and a local `.env`:

```bash
npm run keygen
```

Populate initial staff accounts and sample events across all node databases:

```bash
npm run seed
```

Default credentials:

- Admin: `admin@campus.edu` / `AdminPass123!`
- Booth Staff: `booth1@campus.edu`, `booth2@campus.edu` / `BoothPass123!`
- Gate Staff: `gate1@campus.edu`, `gate2@campus.edu` / `GatePass123!`

### 3. Start the 6-Node Cluster

Launch all 6 nodes concurrently with colored logs:

```bash
npm run cluster
```

The nodes will start at:

- `B1`: http://localhost:4001 (Booth 1)
- `B2`: http://localhost:4002 (Booth 2)
- `B3`: http://localhost:4003 (Booth 3)
- `G1`: http://localhost:4004 (Gate 1)
- `G2`: http://localhost:4005 (Gate 2)
- `G3`: http://localhost:4006 (Gate 3)

Verify health on any node:

```bash
curl http://localhost:4001/health
curl http://localhost:4001/node/info
```

### 4. Run Individual Nodes

```bash
npm run node:b1   # Booth 1 (Port 4001)
npm run node:b2   # Booth 2 (Port 4002)
npm run node:b3   # Booth 3 (Port 4003)
npm run node:g1   # Gate 1 (Port 4004)
npm run node:g2   # Gate 2 (Port 4005)
npm run node:g3   # Gate 3 (Port 4006)
```

### 5. Start the Web Dashboard

```bash
npm run dev -w apps/web
```

Open [http://localhost:3000](http://localhost:3000) to view the cluster architecture dashboard.

---

## Testing & Quality Assurance

Run the test suite across all packages:

```bash
npm run test
```

Run ESLint and code formatting checks:

```bash
npm run lint          # ESLint checks (0 errors, 0 warnings)
npm run format:check  # Prettier formatting verification
npm run format        # Auto-format all files
```

---

## Project Roadmap & Stage Ownership

| Stage       | Focus                                            | Owner    | Status   |
| ----------- | ------------------------------------------------ | -------- | -------- |
| **Stage 1** | Foundation & Core Primitives                     | Member 1 | **DONE** |
| **Stage 2** | Auth, Events & Booth Ticket Sales                | Member 2 | **DONE** |
| **Stage 3** | Peer Membership, Failure Detection & Replication | Member 3 | PENDING  |
| **Stage 4** | Gate Validation, Quorum & Conflict Resolution    | Member 4 | PENDING  |
| **Stage 5** | Admin Dashboard, Booth UI & Failover Client      | Member 5 | PENDING  |
| **Stage 6** | Gate Scanner UI, Live Dashboard & Chaos Tools    | Member 6 | PENDING  |

---

## Documentation Links

- [docs/PROJECT_CONTEXT.md](file:///e:/FestPass/docs/PROJECT_CONTEXT.md): In-depth distributed systems architecture, design rationale, and Stage 2 handoff guide.
- [docs/API_CONTRACT.md](file:///e:/FestPass/docs/API_CONTRACT.md): Comprehensive REST API, peer protocol, and Socket.IO event contracts.
- [CONTEXT.md](file:///e:/FestPass/CONTEXT.md): Team developer guidelines and hard constraints.
