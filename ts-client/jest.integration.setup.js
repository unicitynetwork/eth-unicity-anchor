/**
 * Setup file specific to integration tests
 */

// Set a longer timeout for integration tests
jest.setTimeout(60000);

// Global beforeAll hook for integration test suites
beforeAll(() => {
  console.log('Starting integration test suite');
  
  // Give the node some time to stabilize
  return new Promise(resolve => setTimeout(resolve, 1000));
});

// Global afterAll hook for integration test suites
afterAll(() => {
  console.log('Completed integration test suite');
  
  // Allow time for provider cleanup
  return new Promise(resolve => setTimeout(resolve, 1000));
});