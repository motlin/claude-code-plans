import {writeFileSync, mkdirSync, rmSync, utimesSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {listPlans, readPlan, writePlan, getPlanMtime, buildPlanNotModifiedResponse} from '../src/lib/plans.js';

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
		expect(plans).toStrictEqual([]);
	});

	it('lists plans sorted by mtime descending (newest first)', async () => {
		const older = join(testDir, 'older-plan.md');
		const newer = join(testDir, 'newer-plan.md');
		writeFileSync(older, '# Older Plan');
		writeFileSync(newer, '# Newer Plan');

		const pastTime = new Date(Date.now() - 60000);
		utimesSync(older, pastTime, pastTime);

		const plans = await listPlans(testDir);
		expect(plans.map((p) => p.filename)).toStrictEqual(['newer-plan.md', 'older-plan.md']);
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
		expect(plans.map((p) => p.filename)).toStrictEqual(['plan.md']);
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
		expect(content).toBe(null);
	});

	it('rejects path traversal with ..', async () => {
		const content = await readPlan(testDir, '../etc/passwd');
		expect(content).toBe(null);
	});

	it('rejects files not ending in .md', async () => {
		writeFileSync(join(testDir, 'secret.txt'), 'secret');
		const content = await readPlan(testDir, 'secret.txt');
		expect(content).toBe(null);
	});

	it('rejects absolute paths', async () => {
		const content = await readPlan(testDir, '/etc/passwd');
		expect(content).toBe(null);
	});

	it('rejects filenames with slashes', async () => {
		const content = await readPlan(testDir, 'subdir/plan.md');
		expect(content).toBe(null);
	});
});

describe('writePlan', () => {
	it('writes content to a plan file', async () => {
		const ok = await writePlan(testDir, 'new-plan.md', '# New Plan\n\nContent');
		expect(ok).toBe(true);
		const written = readFileSync(join(testDir, 'new-plan.md'), 'utf-8');
		expect(written).toBe('# New Plan\n\nContent');
	});

	it('overwrites an existing plan file', async () => {
		writeFileSync(join(testDir, 'existing.md'), '# Old');
		const ok = await writePlan(testDir, 'existing.md', '# Updated');
		expect(ok).toBe(true);
		const written = readFileSync(join(testDir, 'existing.md'), 'utf-8');
		expect(written).toBe('# Updated');
	});

	it('rejects path traversal with ..', async () => {
		const ok = await writePlan(testDir, '../evil.md', 'bad');
		expect(ok).toBe(false);
	});

	it('rejects filenames with slashes', async () => {
		const ok = await writePlan(testDir, 'sub/file.md', 'bad');
		expect(ok).toBe(false);
	});

	it('rejects non-md extension', async () => {
		const ok = await writePlan(testDir, 'file.txt', 'bad');
		expect(ok).toBe(false);
	});
});

describe('getPlanMtime', () => {
	it('returns mtime for an existing plan file', async () => {
		const before = new Date();
		writeFileSync(join(testDir, 'test.md'), '# Test');
		const mtime = await getPlanMtime(testDir, 'test.md');
		expect(mtime).toBeInstanceOf(Date);
		expect(mtime!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
	});

	it('returns mtime matching file stat', async () => {
		const filePath = join(testDir, 'stamped.md');
		writeFileSync(filePath, '# Stamped');
		const fixedTime = new Date('1999-12-31T00:00:00Z');
		utimesSync(filePath, fixedTime, fixedTime);
		const mtime = await getPlanMtime(testDir, 'stamped.md');
		expect(mtime!.getTime()).toBe(fixedTime.getTime());
	});

	it('returns null for non-existent file', async () => {
		const mtime = await getPlanMtime(testDir, 'nope.md');
		expect(mtime).toBe(null);
	});

	it('rejects path traversal', async () => {
		const mtime = await getPlanMtime(testDir, '../etc/passwd');
		expect(mtime).toBe(null);
	});

	it('rejects non-md files', async () => {
		writeFileSync(join(testDir, 'secret.txt'), 'secret');
		const mtime = await getPlanMtime(testDir, 'secret.txt');
		expect(mtime).toBe(null);
	});
});

describe('buildPlanNotModifiedResponse', () => {
	it('returns a 304 when If-None-Match matches the row sha', () => {
		const sha = 'abc123';
		const response = buildPlanNotModifiedResponse(`"${sha}"`, {sha});
		expect(response).not.toBeNull();
		expect(response!.status).toBe(304);
		expect(response!.headers.get('ETag')).toBe(`"${sha}"`);
		expect(response!.headers.get('Cache-Control')).toBe('private, max-age=0, must-revalidate');
	});

	it('returns null when If-None-Match is absent', () => {
		expect(buildPlanNotModifiedResponse(null, {sha: 'abc123'})).toBeNull();
	});

	it('returns null when If-None-Match differs from the row sha', () => {
		expect(buildPlanNotModifiedResponse('"stale"', {sha: 'fresh'})).toBeNull();
	});

	it('returns null when the row is missing', () => {
		expect(buildPlanNotModifiedResponse('"any"', null)).toBeNull();
	});

	it('treats an unquoted If-None-Match as a mismatch (server emits quoted ETags)', () => {
		// HTTP ETags are quoted strings — a client sending the bare sha
		// should not get a 304.
		expect(buildPlanNotModifiedResponse('abc123', {sha: 'abc123'})).toBeNull();
	});
});
