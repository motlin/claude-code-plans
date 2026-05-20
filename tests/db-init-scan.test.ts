import {describe, expect, it, vi, beforeEach} from 'vitest';
import {openTestDb, type AppDb} from '../src/lib/db/connection';

/**
 * Tests for the post-watcher-ready boot ordering implemented in
 * `src/lib/db/index.ts` (`initDb` / `runInitialScan` / `awaitInitialScan`).
 *
 * The production boot order is:
 *   1. `initDb()` — opens the DB, runs schema migrations, returns.
 *   2. `createWatcher(...)` + `await watcher.once('ready')`
 *   3. `runInitialScan()` — runs `fullScan` (which now includes `scanPlansDir`).
 *   4. `startSweep()`
 *
 * Watcher event handlers `await awaitInitialScan()` before touching the DB
 * so events fired between `'ready'` and scan completion are serialized
 * behind the scan instead of racing it.
 *
 * Because `runInitialScan`'s in-flight promise is memoized via `hmrPersist`
 * (which falls back to a module-private cache when `import.meta.hot` is
 * undefined, e.g. in tests), every test calls `vi.resetModules()` and
 * re-imports a fresh copy of `src/lib/db/index.ts` so the holder starts
 * empty.
 */
describe('db boot ordering', () => {
	let testDb: AppDb;

	beforeEach(() => {
		vi.resetModules();
		vi.doUnmock('../src/lib/db/connection');
		vi.doUnmock('../src/lib/db/indexer');
		testDb = openTestDb();
	});

	function mockDbModule(opts: {fullScan?: ReturnType<typeof vi.fn>}): void {
		const fullScan = opts.fullScan ?? vi.fn(async () => {});

		vi.doMock('../src/lib/db/connection', async () => {
			const actual = await vi.importActual<typeof import('../src/lib/db/connection')>('../src/lib/db/connection');
			return {
				...actual,
				openAppDb: () => testDb,
			};
		});

		vi.doMock('../src/lib/db/indexer', async () => {
			const actual = await vi.importActual<typeof import('../src/lib/db/indexer')>('../src/lib/db/indexer');
			return {
				...actual,
				fullScan,
			};
		});
	}

	it('initDb() returns without running fullScan and leaves awaitInitialScan() a no-op', async () => {
		const fullScan = vi.fn(async () => {});
		mockDbModule({fullScan});

		const {initDb, awaitInitialScan} = await import('../src/lib/db');

		await initDb();

		expect(fullScan).not.toHaveBeenCalled();

		// awaitInitialScan() must be safe to call before any scan has started.
		// It resolves immediately (the holder's promise is null).
		let resolved = false;
		await Promise.race([
			awaitInitialScan().then(() => {
				resolved = true;
			}),
			new Promise<void>((resolve) => setTimeout(resolve, 0)),
		]);
		expect(resolved).toBe(true);

		// Confirm awaiting again before runInitialScan() still does no work.
		await awaitInitialScan();
		expect(fullScan).not.toHaveBeenCalled();
	});

	it('runInitialScan() is idempotent — concurrent calls share one promise and run fullScan once', async () => {
		const fullScan = vi.fn(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
		mockDbModule({fullScan});

		const {runInitialScan} = await import('../src/lib/db');

		const a = runInitialScan();
		const b = runInitialScan();

		expect(a).toBe(b);

		await Promise.all([a, b]);

		expect(fullScan).toHaveBeenCalledTimes(1);

		// A third call after completion should still return the same memoized
		// promise — no second scan kicks off.
		const c = runInitialScan();
		expect(c).toBe(a);
		await c;
		expect(fullScan).toHaveBeenCalledTimes(1);
	});

	it('handler awaiting awaitInitialScan() before runInitialScan() resolves runs exactly once, after the scan', async () => {
		const order: string[] = [];
		let scanResolve: () => void = () => {};
		const fullScan = vi.fn(async () => {
			order.push('scan:start');
			await new Promise<void>((resolve) => {
				scanResolve = resolve;
			});
			order.push('scan:end');
		});
		mockDbModule({fullScan});

		const {runInitialScan, awaitInitialScan} = await import('../src/lib/db');

		// Simulate the watcher pattern: a handler that `await`s the scan
		// before doing any DB work.
		const handlerCalls: number[] = [];
		const handler = async (): Promise<void> => {
			await awaitInitialScan();
			order.push('handler');
			handlerCalls.push(Date.now());
		};

		// Kick the scan, then queue a handler invocation while the scan is
		// still in-flight. The handler must observe the post-scan state.
		const scanPromise = runInitialScan();
		const handlerPromise = handler();

		// Let microtasks settle so the handler reaches its `await`.
		await Promise.resolve();
		await Promise.resolve();

		// Confirm the handler hasn't yet logged itself — it's blocked on the
		// in-flight scan promise.
		expect(order).toStrictEqual(['scan:start']);

		// Release the scan; the handler should resolve in order.
		scanResolve();
		await Promise.all([scanPromise, handlerPromise]);

		expect(order).toStrictEqual(['scan:start', 'scan:end', 'handler']);
		expect(handlerCalls.length).toBe(1);
	});

	it('handler awaiting awaitInitialScan() after the scan resolves runs immediately', async () => {
		const fullScan = vi.fn(async () => {});
		mockDbModule({fullScan});

		const {runInitialScan, awaitInitialScan} = await import('../src/lib/db');

		await runInitialScan();

		// After the scan completes, `awaitInitialScan()` should resolve
		// immediately for handlers that fire later.
		let resolved = false;
		await Promise.race([
			awaitInitialScan().then(() => {
				resolved = true;
			}),
			new Promise<void>((resolve) => setTimeout(resolve, 0)),
		]);
		expect(resolved).toBe(true);
	});
});
