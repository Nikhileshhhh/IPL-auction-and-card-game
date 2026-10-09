import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';
import globals from 'globals';

const SERVER_ONLY_MODULES = [
  '@stumps/game-engines',
  '@stumps/game-engines/*',
  '@stumps/server',
  '@stumps/server/*',
  'pg',
  'argon2',
  'socket.io',
  '**/apps/server/**',
];

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/next-env.d.ts',
      'docs/spec/**',
      'playwright-report/**',
      'test-results/**',
      '.local/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['error', 'warn'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, '@next/next': nextPlugin },
    languageOptions: { globals: { ...globals.browser } },
    settings: { next: { rootDir: 'apps/web/' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: SERVER_ONLY_MODULES,
              message: 'Server-only code must not be imported into the web app (ADR-004).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/contracts/src/**/*.ts', 'packages/ui/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*', ...SERVER_ONLY_MODULES], message: 'Browser-safe package.' },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/game-engines/src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Pass server time explicitly.' },
        { object: 'Math', property: 'random', message: 'Use the committed RNG stream.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Pass server time explicitly.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:fs', 'node:net', 'node:http', 'pg', 'socket.io', 'fastify'],
              message: 'Engines are IO-free.',
            },
          ],
        },
      ],
    },
  },
);
