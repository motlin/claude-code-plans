import {writeFileSync, mkdirSync, rmSync, utimesSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {openTestDb, type AppDb} from '../../src/lib/db/connection';
import {deletePlan, indexPlanFile, scanPlansDir} from '../../src/lib/db/indexer';
import * as schema from '../../src/lib/db/schema';
import {eq} from 'drizzle-orm';

const testDir = join(tmpdir(), 'claude-plans-indexer-test-' + process.pid);
let db: AppDb;

function writePlanFile(plansDir: string, filename: string, content: string, mtimeMs?: number): string {
	mkdirSync(plansDir, {recursive: true});
	const filePath = join(plansDir, filename);
	writeFileSync(filePath, content);
	if (mtimeMs !== undefined) {
		const secs = mtimeMs / 1000;
		utimesSync(filePath, secs, secs);
	}
	return filePath;
}

beforeEach(() => {
	mkdirSync(testDir, {recursive: true});
	db = openTestDb();
});

afterEach(() => {
	db.close();
	rmSync(testDir, {recursive: true, force: true});
});

describe('indexPlanFile', () => {
	it('inserts a fresh row with title from heading and mtimeMs from stat', async () => {
		const plansDir = join(testDir, 'plans');
		const filePath = writePlanFile(plansDir, 'fresh.md', '# Fresh Plan\n\nbody');

		const result = await indexPlanFile(db.index, plansDir, 'fresh.md');
		expect(result).toStrictEqual({changed: true});

		const rows = db.index.select().from(schema.plans).all();
		expect(rows.length).toBe(1);
		expect(rows[0]!.filename).toBe('fresh.md');
		expect(rows[0]!.title).toBe('Fresh Plan');
		expect(typeof rows[0]!.mtimeMs).toBe('number');
		expect(rows[0]!.mtimeMs).toBeGreaterThan(0);

		// indexed_files cache row written alongside the plans row
		const cache = db.index.select().from(schema.indexedFiles).where(eq(schema.indexedFiles.path, filePath)).get();
		expect(cache).toBeDefined();
		expect(cache!.mtimeMs).toBe(rows[0]!.mtimeMs);
	});

	it('short-circuits as a no-op when the indexed_files mtime is unchanged', async () => {
		const plansDir = join(testDir, 'plans');
		writePlanFile(plansDir, 'same.md', '# Same Plan\n\nbody');

		const first = await indexPlanFile(db.index, plansDir, 'same.md');
		expect(first).toStrictEqual({changed: true});

		// Second call with no mtime change should short-circuit on the
		// indexed_files cache without rewriting the plans row.
		const second = await indexPlanFile(db.index, plansDir, 'same.md');
		expect(second).toStrictEqual({changed: false});

		const rows = db.index.select().from(schema.plans).all();
		expect(rows.length).toBe(1);
		expect(rows[0]!.title).toBe('Same Plan');
	});

	it('updates the row when content changes and mtime advances', async () => {
		const plansDir = join(testDir, 'plans');
		const filePath = writePlanFile(plansDir, 'changes.md', '# Original\n\nbody');

		await indexPlanFile(db.index, plansDir, 'changes.md');
		const firstRow = db.index.select().from(schema.plans).where(eq(schema.plans.filename, 'changes.md')).get();
		if (!firstRow) throw new Error('Expected plan row after first index');
		const firstMtime = firstRow.mtimeMs;

		writeFileSync(filePath, '# Updated\n\nnew body');
		const laterMs = firstMtime + 10_000;
		utimesSync(filePath, laterMs / 1000, laterMs / 1000);

		const result = await indexPlanFile(db.index, plansDir, 'changes.md');
		expect(result).toStrictEqual({changed: true});

		const rows = db.index.select().from(schema.plans).all();
		expect(rows.length).toBe(1);
		expect(rows[0]!.title).toBe('Updated');
		expect(Math.abs(rows[0]!.mtimeMs - laterMs)).toBeLessThan(1);
		expect(rows[0]!.mtimeMs).toBeGreaterThan(firstMtime);
	});

	it('deletes the row when the file is missing on disk', async () => {
		const plansDir = join(testDir, 'plans');
		const filePath = writePlanFile(plansDir, 'goner.md', '# Goner');

		await indexPlanFile(db.index, plansDir, 'goner.md');
		expect(db.index.select().from(schema.plans).all().length).toBe(1);

		rmSync(filePath);

		const result = await indexPlanFile(db.index, plansDir, 'goner.md');
		expect(result).toStrictEqual({changed: true});

		expect(db.index.select().from(schema.plans).all()).toStrictEqual([]);
		expect(
			db.index.select().from(schema.indexedFiles).where(eq(schema.indexedFiles.path, filePath)).get(),
		).toBeUndefined();
	});
});

describe('deletePlan', () => {
	it('removes the plans row and the matching indexed_files row', async () => {
		const plansDir = join(testDir, 'plans');
		const filePath = writePlanFile(plansDir, 'doomed.md', '# Doomed');

		await indexPlanFile(db.index, plansDir, 'doomed.md');
		expect(db.index.select().from(schema.plans).all().length).toBe(1);
		expect(
			db.index.select().from(schema.indexedFiles).where(eq(schema.indexedFiles.path, filePath)).get(),
		).toBeDefined();

		deletePlan(db.index, plansDir, 'doomed.md');

		expect(db.index.select().from(schema.plans).all()).toStrictEqual([]);
		expect(
			db.index.select().from(schema.indexedFiles).where(eq(schema.indexedFiles.path, filePath)).get(),
		).toBeUndefined();
	});

	it('is idempotent — calling on a missing plan is a no-op', () => {
		const plansDir = join(testDir, 'plans');
		mkdirSync(plansDir, {recursive: true});

		expect(() => deletePlan(db.index, plansDir, 'never-existed.md')).not.toThrow();
		expect(() => deletePlan(db.index, plansDir, 'never-existed.md')).not.toThrow();

		expect(db.index.select().from(schema.plans).all()).toStrictEqual([]);
	});
});

describe('scanPlansDir', () => {
	it('inserts new files, updates changed files, and prunes missing files', async () => {
		const plansDir = join(testDir, 'plans');

		// Initial state: a.md and b.md present.
		writePlanFile(plansDir, 'a.md', '# A v1');
		const bPath = writePlanFile(plansDir, 'b.md', '# B');

		await scanPlansDir(db.index, plansDir);

		const initialRows = db.index.select().from(schema.plans).all();
		expect(initialRows.length).toBe(2);
		const initialB = initialRows.find((r) => r.filename === 'b.md');
		if (!initialB) throw new Error('Expected b.md row after initial scan');

		// Mutate: rewrite a.md with new content + later mtime, add c.md, remove b.md.
		const aPath = join(plansDir, 'a.md');
		writeFileSync(aPath, '# A v2');
		const laterMs = initialB.mtimeMs + 10_000;
		utimesSync(aPath, laterMs / 1000, laterMs / 1000);

		writePlanFile(plansDir, 'c.md', '# C');
		rmSync(bPath);

		await scanPlansDir(db.index, plansDir);

		const rows = db.index.select().from(schema.plans).all();
		expect(rows.length).toBe(2);

		const byName = new Map(rows.map((r) => [r.filename, r]));
		const a = byName.get('a.md');
		const c = byName.get('c.md');
		if (!a) throw new Error('Expected a.md row after second scan');
		if (!c) throw new Error('Expected c.md row after second scan');

		expect(a.title).toBe('A v2');
		expect(c.title).toBe('C');
		expect(byName.has('b.md')).toBe(false);

		// indexed_files cache for the removed file is gone too
		expect(
			db.index.select().from(schema.indexedFiles).where(eq(schema.indexedFiles.path, bPath)).get(),
		).toBeUndefined();
	});

	it('returns silently when the plans directory does not exist', async () => {
		await scanPlansDir(db.index, join(testDir, 'no-such-dir'));
		expect(db.index.select().from(schema.plans).all()).toStrictEqual([]);
	});
});
