/**
 * Express Application Setup
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const requestIdMiddleware = require('./middleware/requestId');
const { errorHandler } = require('./middleware/errorHandler');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const eventsRoutes = require('./routes/events');
const ticketsRoutes = require('./routes/tickets');
const statsRoutes = require('./routes/stats');
const gateRoutes = require('./routes/gate');
const clusterRoutes = require('./routes/cluster');
const internalRoutes = require('./routes/internal');

function createApp() {
  const app = express();

  // Security and utilities
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request ID & Logger Context
  app.use(requestIdMiddleware);

  // Rate Limiting (permissive for local cluster simulation)
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5000,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);

  // Mount Routes (supporting both /api/* and direct root paths per API contract)
  app.use('/', healthRoutes); // /health and /node/info

  app.use('/api/auth', authRoutes);
  app.use('/auth', authRoutes);

  app.use('/api/events', eventsRoutes);
  app.use('/events', eventsRoutes);

  app.use('/api/tickets', ticketsRoutes);
  app.use('/tickets', ticketsRoutes);

  app.use('/api/stats', statsRoutes);
  app.use('/stats', statsRoutes);

  app.use('/api/gate', gateRoutes);
  app.use('/gate', gateRoutes);

  app.use('/api/cluster', clusterRoutes);
  app.use('/cluster', clusterRoutes);

  app.use('/internal', internalRoutes);

  // 404 Handler
  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found',
      },
    });
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}

module.exports = {
  createApp,
};
