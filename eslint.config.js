const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.commonjs
            }
        },
        rules: {
            // Semantic / correctness rules carried over from the legacy
            // .eslintrc.json strict ruleset. Pure-formatting rules dropped —
            // those live in @stylistic/eslint-plugin now (out of scope here).

            'consistent-return': 'error',
            'default-case': 'error',
            'default-case-last': 'error',
            'eqeqeq': 'off',
            'newline-before-return': 'error',
            'no-console': 'error',
            'no-duplicate-imports': 'error',
            'no-else-return': 'error',
            'no-eq-null': 'error',
            'no-implicit-globals': 'error',
            'no-loop-func': 'error',
            'no-magic-numbers': 'off',
            'no-multi-assign': 'error',
            'no-nested-ternary': 'error',
            'no-param-reassign': 'error',
            'no-process-exit': 'error',
            'no-return-assign': 'off',
            'no-self-compare': 'error',
            'no-sequences': 'error',
            'no-shadow': 'error',
            'no-throw-literal': 'error',
            // `no-undefined` fights modern jest patterns (`mockImplementation(() => undefined)`);
            // the legacy config had it error'd but the codebase wasn't being linted. Drop.
            'no-unused-expressions': 'error',
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'no-useless-concat': 'error',
            'no-useless-return': 'error',
            'no-var': 'error',
            'prefer-const': 'off',
            'prefer-template': 'error',
            'require-await': 'off',
            'require-unicode-regexp': 'error',
            'sort-imports': ['error', { ignoreDeclarationSort: true }]
        }
    },
    {
        // Test files run under Jest — add globals and relax rules that fight
        // test patterns (describe blocks nested deep, mock underscore conventions,
        // unused params for ignored callback args).
        files: ['**/*.test.js'],
        languageOptions: {
            globals: { ...globals.jest }
        },
        rules: {
            'max-nested-callbacks': 'off',
            'newline-before-return': 'off',
            'no-underscore-dangle': 'off',
            'no-unused-vars': 'off',
            'no-shadow': 'off'
        }
    },
    {
        ignores: [
            'node_modules/**',
            'coverage/**',
            'downloads/**',
            'manual_queue/**',
            '_bmad/**',
            '_bmad-output/**',
            'database/**',
            'tools/**',
            'assets/**',
            '.claude/**'
        ]
    }
];
