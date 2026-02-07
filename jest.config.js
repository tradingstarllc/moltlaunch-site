module.exports = {
  testEnvironment: 'node',
  testTimeout: 90000,  // Increased for Cauldron calls (E2E)
  verbose: true,
  collectCoverageFrom: [
    'server.js',
    'stark-prover/**/*.js',
    'execution-traces/**/*.js',
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  setupFilesAfterEnv: ['./tests/setup.js']
};
