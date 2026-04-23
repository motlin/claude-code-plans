import {describe, expect, it, vi, beforeEach} from 'vitest';

describe('hmrPersist', () => {
	// In the test environment, import.meta.hot is undefined (production-like).
	// We test the production fallback path (module-scoped cache).

	beforeEach(() => {
		// Reset the module between tests so the cache is fresh.
		vi.resetModules();
	});

	it('returns the initialized value on first call', async () => {
		const {hmrPersist} = await import('../src/lib/hmr-persist');
		const result = hmrPersist('testKey', () => new Set([1, 2, 3]));
		expect(result).toBeInstanceOf(Set);
		expect(result).toStrictEqual(new Set([1, 2, 3]));
	});

	it('returns the same instance on subsequent calls with the same key', async () => {
		const {hmrPersist} = await import('../src/lib/hmr-persist');
		const first = hmrPersist('sameKey', () => new Map<string, number>());
		first.set('a', 1);
		const second = hmrPersist('sameKey', () => new Map<string, number>());
		expect(second).toBe(first);
		expect(second.get('a')).toBe(1);
	});

	it('does not call init again for an existing key', async () => {
		const {hmrPersist} = await import('../src/lib/hmr-persist');
		const init = vi.fn(() => 42);
		hmrPersist('onceKey', init);
		hmrPersist('onceKey', init);
		hmrPersist('onceKey', init);
		expect(init).toHaveBeenCalledTimes(1);
	});

	it('keeps separate values for different keys', async () => {
		const {hmrPersist} = await import('../src/lib/hmr-persist');
		const a = hmrPersist('keyA', () => 'alpha');
		const b = hmrPersist('keyB', () => 'beta');
		expect(a).toBe('alpha');
		expect(b).toBe('beta');
	});
});

describe('hmrDispose', () => {
	it('does not throw when import.meta.hot is undefined', async () => {
		const {hmrDispose} = await import('../src/lib/hmr-persist');
		expect(() => hmrDispose(() => {})).not.toThrow();
	});
});
