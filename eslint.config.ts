import globals from 'globals';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import type {Linter} from 'eslint';

const config: Linter.Config[] = [
	{ignores: ['dist', 'coverage', '.llm/**']},
	{
		files: ['vitest.config.ts'],
		languageOptions: {
			globals: {
				process: 'readonly',
			},
		},
	},
	{
		files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
		languageOptions: {
			globals: {
				...globals.node,
				vi: 'readonly',
				expect: 'readonly',
				it: 'readonly',
				describe: 'readonly',
				beforeEach: 'readonly',
				afterEach: 'readonly',
				beforeAll: 'readonly',
				afterAll: 'readonly',
			},
		},
	},
	{
		files: ['**/*.{ts,tsx}'],
		languageOptions: {
			ecmaVersion: 2022,
			globals: {
				...globals.node,
			},
			parser: tsparser,
			parserOptions: {
				ecmaVersion: 'latest',
				sourceType: 'module',
				project: './tsconfig.check.json',
			},
		},
		plugins: {
			'@typescript-eslint': tseslint as any,
		},
		rules: {
			...(tseslint.configs?.['recommended']?.rules ?? {}),
			'@typescript-eslint/no-unused-vars': ['error', {varsIgnorePattern: '^([A-Z_]|_)', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_'}],
			'@typescript-eslint/no-explicit-any': 'off',
			eqeqeq: ['error', 'smart'],
			'one-var': ['error', 'never'],
		},
	},
];

export default config;
