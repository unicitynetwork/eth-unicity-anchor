/**
 * Global Jest setup file
 * 
 * This file contains global setup logic that runs before all tests.
 * It's referenced in jest.config.js via setupFilesAfterEnv.
 */

// Increase default timeout for all tests to 30 seconds
jest.setTimeout(30000);

// Add custom matchers if needed
// expect.extend({...});

// Global beforeAll hook for all test suites
beforeAll(() => {
  // This runs once before all tests
  console.log('Starting TypeScript client test suite');
});

// Global afterAll hook for all test suites
afterAll(() => {
  // This runs once after all tests
  console.log('Completed TypeScript client test suite');
  
  // Give time for any promises to resolve before the test exits
  // This helps prevent "Jest did not exit one second after the test run completed" warnings
  return new Promise(resolve => setTimeout(resolve, 500));
});