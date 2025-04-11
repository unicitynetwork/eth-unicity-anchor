/**
 * Jest configuration specific to integration tests
 */
const baseConfig = require('./jest.config');

module.exports = {
  ...baseConfig,
  // Only run integration tests
  testMatch: ['**/tests/integration/**/*.test.ts'],
  // Increase timeout for integration tests to 120 seconds
  testTimeout: 120000,
  // Setup file specific to integration tests
  setupFilesAfterEnv: ['./jest.integration.setup.js'],
  // Integration tests are not included in coverage reports by default
  collectCoverage: false,
  // Give more time to tests overall
  maxWorkers: 1,
  // Allow more time for cleanup
  forceExit: true,
  // Retry failed tests
  retryTimes: 1
};