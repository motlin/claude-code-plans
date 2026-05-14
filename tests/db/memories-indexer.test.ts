import {writeFileSync, mkdirSync, rmSync, utimesSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {beforeEach, afterEach, describe, expect, it} from 'vitest';
import {openTestDb, type AppDb} from '../../src/lib/db/connection';
import {indexFile, indexMemoryFile, scanMemoriesForProject} from '../../src/lib/db/indexer';
import * as schema from '../../src/lib/db/schema';
import {eq} from 'drizzle-orm';

const testDir = join(tmpdir(), 'claude-memories-indexer-test-' + process.pid);
const projectId = '-Users-test-project';
let db: AppDb;

function writeMemoryFile(filename: string, content: string, mtimeMs?: number): string {
	const memDir = join(testDir, projectId, 'memory');
	mkdirSync(memDir, {recursive: true});
	const filePath = join(memDir, filename);
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

describe('scanMemoriesForProject', () => {
	it('indexes all .md files under {projectsDir}/{projectId}/memory/', async () => {
		writeMemoryFile('alpha.md', '# Alpha title\n\nbody');
		writeMemoryFile('beta.md', '# Beta title\n\nbody');
		writeMemoryFile('skip.txt', 'not markdown');

		await scanMemoriesForProject(db.index, testDir, projectId);

		const rows = db.index.select().from(schema.memories).all();
		expect(rows.length).toBe(2);

		const byName = new Map(rows.map((r) => [r.filename, r]));
		const alpha = byName.get('alpha.md');
		const beta = byName.get('beta.md');

		if (!alpha) throw new Error('Expected alpha.md row');
		if (!beta) throw new Error('Expected beta.md row');

		expect(alpha.projectId).toBe(projectId);
		expect(alpha.title).toBe('Alpha title');
		expect(typeof alpha.mtimeMs).toBe('number');
		expect(alpha.mtimeMs).toBeGreaterThan(0);

		expect(beta.projectId).toBe(projectId);
		expect(beta.title).toBe('Beta title');
	});

	it('reindexes when a file mtime changes and updates title + mtimeMs', async () => {
		const filePath = writeMemoryFile('alpha.md', '# Original title\n');

		await scanMemoriesForProject(db.index, testDir, projectId);

		const firstRow = db.index.select().from(schema.memories).where(eq(schema.memories.filePath, filePath)).get();
		if (!firstRow) throw new Error('Expected memory row after first scan');
		expect(firstRow.title).toBe('Original title');
		const firstMtime = firstRow.mtimeMs;

		// Rewrite content and bump mtime to a clearly-later value.
		writeFileSync(filePath, '# Updated title\n');
		const laterMs = firstMtime + 10_000;
		utimesSync(filePath, laterMs / 1000, laterMs / 1000);

		await scanMemoriesForProject(db.index, testDir, projectId);

		const secondRow = db.index.select().from(schema.memories).where(eq(schema.memories.filePath, filePath)).get();
		if (!secondRow) throw new Error('Expected memory row after second scan');
		expect(secondRow.title).toBe('Updated title');
		// utimesSync may round-trip through filesystem precision (nanoseconds → ms),
		// so allow a small tolerance instead of exact equality.
		expect(Math.abs(secondRow.mtimeMs - laterMs)).toBeLessThan(1);
		expect(secondRow.mtimeMs).toBeGreaterThan(firstMtime);
	});

	it('prunes memories rows and indexed_files rows when a file is deleted', async () => {
		const keep = writeMemoryFile('keep.md', '# Keep\n');
		const remove = writeMemoryFile('remove.md', '# Remove\n');

		await scanMemoriesForProject(db.index, testDir, projectId);

		expect(db.index.select().from(schema.memories).all().length).toBe(2);
		expect(
			db.index.select().from(schema.indexedFiles).where(eq(schema.indexedFiles.path, remove)).get(),
		).toBeDefined();

		rmSync(remove);

		await scanMemoriesForProject(db.index, testDir, projectId);

		const rows = db.index.select().from(schema.memories).all();
		expect(rows.length).toBe(1);
		expect(rows[0]!.filePath).toBe(keep);

		expect(
			db.index.select().from(schema.indexedFiles).where(eq(schema.indexedFiles.path, remove)).get(),
		).toBeUndefined();
	});

	it('prunes stale rows for a project when its memory dir no longer exists', async () => {
		const filePath = writeMemoryFile('alpha.md', '# Alpha\n');

		await scanMemoriesForProject(db.index, testDir, projectId);
		expect(db.index.select().from(schema.memories).all().length).toBe(1);

		rmSync(join(testDir, projectId, 'memory'), {recursive: true});

		await scanMemoriesForProject(db.index, testDir, projectId);
		expect(db.index.select().from(schema.memories).all()).toStrictEqual([]);
		expect(
			db.index.select().from(schema.indexedFiles).where(eq(schema.indexedFiles.path, filePath)).get(),
		).toBeUndefined();
	});
});

describe('indexMemoryFile', () => {
	it('upserts a single memory file', async () => {
		const filePath = writeMemoryFile('alpha.md', '# Solo title\n');

		await indexMemoryFile(db.index, filePath, projectId);

		const row = db.index.select().from(schema.memories).where(eq(schema.memories.filePath, filePath)).get();
		if (!row) throw new Error('Expected memory row after indexMemoryFile');
		expect(row.filename).toBe('alpha.md');
		expect(row.title).toBe('Solo title');
		expect(row.projectId).toBe(projectId);
	});
});

describe('indexFile dispatcher (memory branch)', () => {
	it('routes memory .md paths to indexMemoryFile', async () => {
		const filePath = writeMemoryFile('alpha.md', '# Dispatcher title\n');

		await indexFile(db.index, filePath, testDir);

		const row = db.index.select().from(schema.memories).where(eq(schema.memories.filePath, filePath)).get();
		if (!row) throw new Error('Expected memory row after indexFile dispatch');
		expect(row.projectId).toBe(projectId);
		expect(row.filename).toBe('alpha.md');
		expect(row.title).toBe('Dispatcher title');
	});

	it('does not write a memory row for non-memory .md paths under projectsDir', async () => {
		const otherDir = join(testDir, projectId, 'other');
		mkdirSync(otherDir, {recursive: true});
		const filePath = join(otherDir, 'README.md');
		writeFileSync(filePath, '# Not a memory\n');

		await indexFile(db.index, filePath, testDir);

		const rows = db.index.select().from(schema.memories).all();
		expect(rows).toStrictEqual([]);
	});
});
