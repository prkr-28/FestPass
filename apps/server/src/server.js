/**
 * FestPass Node Server Process Entry Point
 */

const http = require('http');
const config = require('./config');
const logger = require('./logger');
const { initDb, closeDb } = require('./db');
const { createApp } = require('./app');
const { initSocket } = require('./socket');
const { replicationService } = require('./services/replicationService');

function startServer() {
  logger.info(
    {
      nodeId: config.nodeId,
      role: config.nodeRole,
      index: config.nodeIndex,
      port: config.port,
    },
    'Starting FestPass node...'
  );

  // Initialize SQLite DB & run migrations
  initDb();

  // Create Express App & HTTP Server
  const app = createApp();
  const server = http.createServer(app);

  // Initialize Socket.IO
  initSocket(server);

  server.listen(config.port, () => {
    logger.info(
      {
        nodeId: config.nodeId,
        role: config.nodeRole,
        port: config.port,
        url: `http://localhost:${config.port}`,
      },
      `Node ${config.nodeId} (${config.nodeRole.toUpperCase()}) running at http://localhost:${config.port}`
    );

    // Start Stage 3 peer replication and membership services
    replicationService.start();
  });

  // Graceful shutdown handling
  let isShuttingDown = false;
  function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal, nodeId: config.nodeId }, 'Initiating graceful node shutdown...');
    replicationService.stop();
    server.close(() => {
      logger.info('HTTP server closed');
      closeDb();
      logger.info('Node shutdown complete');
      process.exit(0);
    });

    // Force close after 5 seconds
    setTimeout(() => {
      logger.error('Shutdown timed out. Forcing process exit.');
      process.exit(1);
    }, 5000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { server, app };
}

// Start if executed directly
if (require.main === module) {
  startServer();
}

module.exports = {
  startServer,
};
