const { defineWorkspace } = require('vitest/config');

module.exports = defineWorkspace([
  {
    test: {
      name: 'shared',
      root: './packages/shared',
      globals: true,
      environment: 'node',
    },
  },
  {
    test: {
      name: 'server',
      root: './apps/server',
      globals: true,
      environment: 'node',
      pool: 'threads',
      poolOptions: {
        threads: {
          singleThread: true,
        },
      },
    },
  },
  {
    test: {
      name: 'web',
      root: './apps/web',
      globals: true,
      environment: 'jsdom',
    },
  },
]);
