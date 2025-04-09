/**
 * Jest configuration specific to integration tests
 */
const baseConfig = require('./jest.config');

module.exports = {
  ...baseConfig,
  // Only run integration tests
  testMatch: ['**/tests/integration/**/*.test.ts'],
  // Longer timeout for integration tests (60 seconds)
  testTimeout: 60000,
  // Setup file specific to integration tests
  setupFilesAfterEnv: ['./jest.integration.setup.js'],
  // Integration tests are not included in coverage reports by default
  collectCoverage: false
};