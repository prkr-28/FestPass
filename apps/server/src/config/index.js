/**
 * Server Configuration Loader with Zod Validation
 */

const path = require('path');
const dotenv = require('dotenv');
const { z } = require('zod');
const { NODE_ROLES } = require('@festpass/shared');

// Load .env if present
dotenv.config();
if (!process.env.ED25519_PRIVATE_KEY && !process.env.ED25519_PUBLIC_KEY) {
  dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
}

// Helper to deduce node index from common node ID names (e.g. B1 -> 1, G2 -> 5)
function defaultNodeIndex(nodeId) {
  const map = { B1: 1, B2: 2, B3: 3, G1: 4, G2: 5, G3: 6 };
  return map[nodeId] ?? 1;
}

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1024).max(65535).default(4001),
  NODE_ID: z.string().trim().min(1).default('B1'),
  NODE_ROLE: z.enum([NODE_ROLES.BOOTH, NODE_ROLES.GATE, NODE_ROLES.BOTH]).default(NODE_ROLES.BOOTH),
  NODE_INDEX: z.coerce.number().int().min(0).max(1023).optional(),
  DATA_DIR: z.string().default('./data'),
  JWT_SECRET: z.string().min(8).default('festpass-stage1-dev-jwt-secret-do-not-use-in-production'),
  ED25519_PRIVATE_KEY: z.string().optional(),
  ED25519_PUBLIC_KEY: z.string().optional(),
  PEERS: z
    .string()
    .default(
      'B1=http://localhost:4001,B2=http://localhost:4002,B3=http://localhost:4003,G1=http://localhost:4004,G2=http://localhost:4005,G3=http://localhost:4006'
    ),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

const parsed = envSchema.parse(process.env);

const config = {
  port: parsed.PORT,
  nodeId: parsed.NODE_ID,
  nodeRole: parsed.NODE_ROLE,
  nodeIndex: parsed.NODE_INDEX ?? defaultNodeIndex(parsed.NODE_ID),
  dataDir: path.resolve(process.cwd(), parsed.DATA_DIR),
  jwtSecret: parsed.JWT_SECRET,
  ed25519PrivateKey: parsed.ED25519_PRIVATE_KEY,
  ed25519PublicKey: parsed.ED25519_PUBLIC_KEY,
  peersRaw: parsed.PEERS,
  logLevel: parsed.LOG_LEVEL,

  isBooth() {
    return this.nodeRole === NODE_ROLES.BOOTH || this.nodeRole === NODE_ROLES.BOTH;
  },

  isGate() {
    return this.nodeRole === NODE_ROLES.GATE || this.nodeRole === NODE_ROLES.BOTH;
  },

  /**
   * Parse PEERS into array of { nodeId, url }
   */
  getPeerList() {
    if (!this.peersRaw) return [];
    return this.peersRaw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [nodeId, url] = entry.split('=');
        return {
          nodeId: nodeId ? nodeId.trim() : '',
          url: url ? url.trim() : '',
        };
      })
      .filter((peer) => peer.nodeId && peer.url);
  },
};

module.exports = config;
