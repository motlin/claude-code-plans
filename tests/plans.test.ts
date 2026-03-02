import {writeFileSync, mkdirSync, rmSync, utimesSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {listPlans, readPlan} from '../src/plans.js';

const testDir = join(tmpdir(), 'claude-plans-test-' + process.pid);

beforeEach(() => {
	mkdirSync(testDir, {recursive: true});
});

afterEach(() => {
	rmSync(testDir, {recursive: true, force: true});
});

describe('listPlans', () => {
	it('returns empty array for empty directory', async () => {
		const plans = await listPlans(testDir);
		expect(plans).toEqual([]);
	});

	it('lists plans sorted by mtime descending (newest first)', async () => {
		const older = join(testDir, 'older-plan.md');
		const newer = join(testDir, 'newer-plan.md');
		writeFileSync(older, '# Older Plan');
		writeFileSync(newer, '# Newer Plan');

		const pastTime = new Date(Date.now() - 60000);
		utimesSync(older, pastTime, pastTime);

		const plans = await listPlans(testDir);
		expect(plans).toHaveLength(2);
		expect(plans[0]!.filename).toBe('newer-plan.md');
		expect(plans[1]!.filename).toBe('older-plan.md');
	});

	it('extracts title from # heading', async () => {
		writeFileSync(join(testDir, 'my-plan.md'), '# My Awesome Plan\n\nContent here');
		const plans = await listPlans(testDir);
		expect(plans[0]!.title).toBe('My Awesome Plan');
	});

	it('falls back to humanized filename when no heading', async () => {
		writeFileSync(join(testDir, 'some-plan-name.md'), 'No heading here');
		const plans = await listPlans(testDir);
		expect(plans[0]!.title).toBe('Some Plan Name');
	});

	it('ignores non-md files', async () => {
		writeFileSync(join(testDir, 'notes.txt'), 'not a plan');
		writeFileSync(join(testDir, 'plan.md'), '# Real Plan');
		const plans = await listPlans(testDir);
		expect(plans).toHaveLength(1);
		expect(plans[0]!.filename).toBe('plan.md');
	});

	it('includes mtime in entries', async () => {
		writeFileSync(join(testDir, 'test.md'), '# Test');
		const plans = await listPlans(testDir);
		expect(plans[0]!.mtime).toBeInstanceOf(Date);
	});
});

describe('readPlan', () => {
	it('reads a valid plan file', async () => {
		writeFileSync(join(testDir, 'test.md'), '# Test\n\nContent');
		const content = await readPlan(testDir, 'test.md');
		expect(content).toBe('# Test\n\nContent');
	});

	it('returns null for non-existent file', async () => {
		const content = await readPlan(testDir, 'nope.md');
		expect(content).toBeNull();
	});

	it('rejects path traversal with ..', async () => {
		const content = await readPlan(testDir, '../etc/passwd');
		expect(content).toBeNull();
	});

	it('rejects files not ending in .md', async () => {
		writeFileSync(join(testDir, 'secret.txt'), 'secret');
		const content = await readPlan(testDir, 'secret.txt');
		expect(content).toBeNull();
	});

	it('rejects absolute paths', async () => {
		const content = await readPlan(testDir, '/etc/passwd');
		expect(content).toBeNull();
	});

	it('rejects filenames with slashes', async () => {
		const content = await readPlan(testDir, 'subdir/plan.md');
		expect(content).toBeNull();
	});
});
