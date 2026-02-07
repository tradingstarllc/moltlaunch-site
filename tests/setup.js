/**
 * Test Setup
 * 
 * Configure test environment before running tests.
 */

// Set test environment
process.env.NODE_ENV = 'test';
process.env.PORT = '0';

// Increase timeout for E2E tests
jest.setTimeout(30000);

// Suppress console logs during tests (optional)
// global.console = {
//     ...console,
//     log: jest.fn(),
//     info: jest.fn()
// };
