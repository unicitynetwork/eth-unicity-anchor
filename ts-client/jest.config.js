module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts'
  ],
  coverageReporters: ['text', 'lcov'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
    }],
  },
  // Default timeout for tests (30 seconds)
  testTimeout: 30000,
  // Setup for async operations
  setupFilesAfterEnv: ['./jest.setup.js'],
  // Detect open handles to help debug unfinished async operations
  detectOpenHandles: true,
  verbose: true
};