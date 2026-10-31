/**
 * FestPass Node Process Supervisor (Stage 6)
 *
 * Runs on Port 4000.
 * Allows starting, stopping, killing, and restarting any of the 6 server node processes.
 * Protected by API key in header `X-Supervisor-Key`.
 */

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.SUPERVISOR_PORT || 4000;
const SUPERVISOR_KEY = process.env.SUPERVISOR_KEY || 'festpass-supervisor-secret-key';

app.use(cors());
app.use(express.json());

// API Key Guard middleware
app.use((req, res, next) => {
  // Allow health check without key
  if (req.path === '/health') return next();

  const key = req.headers['x-supervisor-key'] || req.query.key;
  if (!key || key !== SUPERVISOR_KEY) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or missing X-Supervisor-Key header',
    });
  }
  next();
});

const NODE_DEFS = {
  B1: { port: 4001, role: 'booth', index: 1 },
  B2: { port: 4002, role: 'booth', index: 2 },
  B3: { port: 4003, role: 'booth', index: 3 },
  G1: { port: 4004, role: 'gate', index: 4 },
  G2: { port: 4005, role: 'gate', index: 5 },
  G3: { port: 4006, role: 'gate', index: 6 },
};

const processes = new Map();

function startNodeProcess(nodeId) {
  const def = NODE_DEFS[nodeId];
  if (!def) throw new Error(`Unknown node ID: ${nodeId}`);

  if (processes.has(nodeId)) {
    const existing = processes.get(nodeId);
    if (!existing.killed) {
      return { status: 'already_running', pid: existing.pid };
    }
  }

  const serverDir = path.resolve(__dirname, '../../apps/server');
  const serverJs = path.join(serverDir, 'src/server.js');

  const child = spawn(process.execPath, [serverJs], {
    cwd: serverDir,
    env: {
      ...process.env,
      NODE_ID: nodeId,
      PORT: String(def.port),
      NODE_ROLE: def.role,
      NODE_INDEX: String(def.index),
    },
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    console.log(`[Supervisor] Node ${nodeId} exited with code ${code}, signal ${signal}`);
    processes.delete(nodeId);
  });

  processes.set(nodeId, child);
  console.log(`[Supervisor] Started node ${nodeId} (PID: ${child.pid}) on port ${def.port}`);

  return { status: 'started', pid: child.pid, port: def.port };
}

function stopNodeProcess(nodeId) {
  if (!processes.has(nodeId)) {
    return { status: 'not_running' };
  }

  const child = processes.get(nodeId);
  child.kill('SIGTERM');
  processes.delete(nodeId);
  console.log(`[Supervisor] Stopped node ${nodeId} (PID: ${child.pid})`);

  return { status: 'stopped', pid: child.pid };
}

// GET /health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'festpass-supervisor', port: PORT });
});

// GET /nodes
app.get('/nodes', (_req, res) => {
  const statusList = Object.keys(NODE_DEFS).map((nodeId) => {
    const isRunning = processes.has(nodeId);
    const child = processes.get(nodeId);
    return {
      nodeId,
      ...NODE_DEFS[nodeId],
      running: isRunning,
      pid: child ? child.pid : null,
    };
  });

  res.json({ success: true, nodes: statusList });
});

// POST /nodes/:nodeId/start
app.post('/nodes/:nodeId/start', (req, res) => {
  const { nodeId } = req.params;
  try {
    const result = startNodeProcess(nodeId.toUpperCase());
    res.json({ success: true, nodeId, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /nodes/:nodeId/stop
app.post('/nodes/:nodeId/stop', (req, res) => {
  const { nodeId } = req.params;
  try {
    const result = stopNodeProcess(nodeId.toUpperCase());
    res.json({ success: true, nodeId, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /nodes/:nodeId/restart
app.post('/nodes/:nodeId/restart', (req, res) => {
  const { nodeId } = req.params;
  try {
    stopNodeProcess(nodeId.toUpperCase());
    setTimeout(() => {
      const result = startNodeProcess(nodeId.toUpperCase());
      res.json({ success: true, nodeId, ...result });
    }, 400);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /nodes/start-all
app.post('/nodes/start-all', (_req, res) => {
  const results = {};
  for (const nodeId of Object.keys(NODE_DEFS)) {
    try {
      results[nodeId] = startNodeProcess(nodeId);
    } catch (err) {
      results[nodeId] = { error: err.message };
    }
  }
  res.json({ success: true, results });
});

// POST /nodes/stop-all
app.post('/nodes/stop-all', (_req, res) => {
  const results = {};
  for (const nodeId of Object.keys(NODE_DEFS)) {
    try {
      results[nodeId] = stopNodeProcess(nodeId);
    } catch (err) {
      results[nodeId] = { error: err.message };
    }
  }
  res.json({ success: true, results });
});

// Clean up child processes on exit
process.on('SIGINT', () => {
  console.log('[Supervisor] Shutting down child processes...');
  for (const child of processes.values()) {
    try {
      child.kill('SIGTERM');
    } catch (_e) {}
  }
  process.exit(0);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[FestPass Supervisor] Listening on http://localhost:${PORT}`);
  });
}

module.exports = { app, startNodeProcess, stopNodeProcess };
