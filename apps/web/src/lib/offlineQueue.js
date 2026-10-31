import { openDB } from 'idb';
import { api } from '../api/client';

const DB_NAME = 'festpass_offline_db';
const STORE_NAME = 'offline_scans';

async function getDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    },
  });
}

export async function saveOfflineScan({ token, gateNodeId, hlc, scannedAt }) {
  const db = await getDB();
  const scanRecord = {
    token,
    gateNodeId: gateNodeId || 'G1',
    hlc: hlc || `${Date.now()}:0:${gateNodeId || 'G1'}`,
    scannedAt: scannedAt || new Date().toISOString(),
    queuedAt: Date.now(),
  };
  const id = await db.add(STORE_NAME, scanRecord);
  return { id, ...scanRecord };
}

export async function getPendingOfflineScans() {
  const db = await getDB();
  return db.getAll(STORE_NAME);
}

export async function clearPendingOfflineScans() {
  const db = await getDB();
  return db.clear(STORE_NAME);
}

export async function syncOfflineScans() {
  const pending = await getPendingOfflineScans();
  if (pending.length === 0) return { processed: 0, accepted: 0, conflicts: [] };

    try {
    const res = await api.post(
      '/api/gate/scan-offline-batch',
      {
        scans: pending.map((p) => ({
          token: p.token,
          gateNodeId: p.gateNodeId,
          hlc: p.hlc,
          scannedAt: p.scannedAt,
        })),
      },
      {},
      'gate'
    );

    // If successful, clear synced items
    await clearPendingOfflineScans();
    return res.data;
  } catch (err) {
    console.error('Failed to sync offline scans:', err);
    throw err;
  }
}
