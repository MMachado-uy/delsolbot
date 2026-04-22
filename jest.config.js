module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/?(*.)+(test|spec).js'],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/downloads/',
        '/manual_queue/',
        '/_bmad/',
        '/_bmad-output/',
        '/database/'
    ],
    collectCoverageFrom: [
        'app.js',
        'controllers/**/*.js',
        'lib/**/*.js',
        '!**/*.test.js',
        '!**/*.spec.js'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'text-summary', 'html', 'lcov'],
    // Coverage gate per PRD FR32/NFR-M1: ≥80% lines, ≥70% branches.
    // Current actual coverage is substantially higher (98% lines, 89% branches) —
    // ratcheting these thresholds up is a Growth-scope item per PRD Product Scope.
    coverageThreshold: {
        global: {
            branches: 70,
            functions: 80,
            lines: 80,
            statements: 80
        }
    },
    clearMocks: true,
    restoreMocks: true,
    verbose: true
};
