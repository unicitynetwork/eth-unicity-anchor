/**
 * Jest configuration specific to unit tests
 */
const baseConfig = require('./jest.config');

module.exports = {
  ...baseConfig,
  // Only run unit tests (not integration)
  testMatch: ['**/tests/*.test.ts'],
  // Disable code coverage for faster unit test runs
  collectCoverage: false,
  // Force exit after tests complete
  forceExit: true,
  // Don't detect open handles (faster)
  detectOpenHandles: false,
  // Mock modules
  moduleNameMapper: {
    '^ethers$': '<rootDir>/tests/mocks/ethers.mock.ts'
  }
};