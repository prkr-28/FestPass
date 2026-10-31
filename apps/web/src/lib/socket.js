import { io } from 'socket.io-client';
import { getActiveBoothNode, subscribeNodeChanges } from '../api/client';

let socket = null;
const eventHandlers = new Map();

export function getSocket() {
  if (!socket) {
    initSocket(getActiveBoothNode());
    subscribeNodeChanges(({ boothNode }) => {
      if (socket && socket.io.uri !== boothNode) {
        console.log(`[Socket] Reconnecting to new active node: ${boothNode}`);
        socket.disconnect();
        initSocket(boothNode);
      }
    });
  }
  return socket;
}

function initSocket(url) {
  socket = io(url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => {
    console.log(`[Socket.IO] Connected to cluster node at ${url} (id: ${socket.id})`);
  });

  socket.on('disconnect', (reason) => {
    console.log(`[Socket.IO] Disconnected: ${reason}`);
  });

  // Re-register any previously attached custom handlers
  eventHandlers.forEach((callbacks, event) => {
    callbacks.forEach((cb) => socket.on(event, cb));
  });
}

export function onSocketEvent(event, callback) {
  if (!eventHandlers.has(event)) {
    eventHandlers.set(event, new Set());
  }
  eventHandlers.get(event).add(callback);

  const s = getSocket();
  if (s) {
    s.on(event, callback);
  }

  return () => {
    eventHandlers.get(event)?.delete(callback);
    s?.off(event, callback);
  };
}
