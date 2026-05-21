import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {openAppDb} from '../src/lib/db/connection';

describe('openAppDb', () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, {recursive: true, force: true});
		}
	});

	it('throws under vitest when called without an explicit cacheDir', () => {
		expect(() => openAppDb()).toThrow(/must pass an explicit cacheDir/);
	});

	it('opens the databases when given an explicit cacheDir', () => {
		const cacheDir = mkdtempSync(join(tmpdir(), 'open-app-db-test-'));
		tempDirs.push(cacheDir);
		const db = openAppDb({cacheDir});
		db.close();
	});
});
