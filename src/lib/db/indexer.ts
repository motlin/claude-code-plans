import {readdir, readFile, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join, basename} from 'node:path';
import {createInterface} from 'node:readline';
import {eq, sql} from 'drizzle-orm';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import {SessionsIndexSchema, FileHistorySnapshotSchema, CustomTitleRecordSchema} from '../schemas';
import {decodeProjectDir} from '../memory';
import {extractSessionTitle} from '../sessions';
import * as schema from './schema';

type IndexDb = BetterSQLite3Database<typeof schema>;

const PLAN_PATH_RE = /\.claude\/plans\/([^/]+\.md)$/;

function extractFirstUserText(line: string): string | null {
	try {
		const obj = JSON.parse(line) as {
			type: string;
			message?: {content?: string | Array<{type: string; text?: string}>};
		};
		if (obj.type !== 'user') return null;
		const content = obj.message?.content;
		if (!content) return null;
		if (typeof content === 'string') return content;
		if (Array.isArray(content)) {
			for (const block of content) {
				if (block.type === 'text' && typeof block.text === 'string') {
					return block.text;
				}
			}
		}
	} catch {
		// skip malformed lines
	}
	return null;
}

async function readFirstUserMessage(filePath: string): Promise<string | null> {
	const rl = createInterface({
		input: createReadStream(filePath, {encoding: 'utf-8'}),
		crlfDelay: Infinity,
	});
	try {
		for await (const line of rl) {
			if (!line.trim()) continue;
			const text = extractFirstUserText(line);
			if (text !== null) return text;
		}
	} finally {
		rl.close();
	}
	return null;
}

export async function indexSessionsIndex(db: IndexDb, projectDir: string, project: string): Promise<void> {
	const indexPath = join(projectDir, 'sessions-index.json');
	let fileStat: Awaited<ReturnType<typeof stat>>;
	try {
		fileStat = await stat(indexPath);
	} catch {
		return;
	}

	const existing = db.select().from(schema.indexedFiles).where(eq(schema.indexedFiles.path, indexPath)).get();
	if (existing && existing.mtimeMs === fileStat.mtimeMs) return;

	let raw: string;
	try {
		raw = await readFile(indexPath, 'utf-8');
	} catch {
		return;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return;
	}

	const result = SessionsIndexSchema.safeParse(parsed);
	if (!result.success) return;

	const firstEntry = result.data.entries[0];
	const projectPath = firstEntry?.projectPath;
	const projectName = decodeProjectDir(project, projectPath);

	// Upsert project
	db.insert(schema.projects)
		.values({
			id: project,
			name: projectName,
			projectPath: projectPath ?? null,
			updatedAt: fileStat.mtimeMs,
		})
		.onConflictDoUpdate({
			target: schema.projects.id,
			set: {name: projectName, projectPath: projectPath ?? null, updatedAt: fileStat.mtimeMs},
		})
		.run();

	// Upsert sessions
	for (const entry of result.data.entries) {
		const fp = entry.firstPrompt as string | undefined;
		const summ = entry.summary as string | undefined;
		const branch = entry.gitBranch as string | undefined;
		const msgCount = (entry.messageCount as number | undefined) ?? 0;
		const sidechain = entry.isSidechain as boolean | undefined;
		const title = summ ?? (fp ? extractSessionTitle(fp, entry.sessionId) : entry.sessionId);
		const createdAt = entry.created ? new Date(entry.created as string).getTime() : entry.fileMtime;

		db.insert(schema.sessions)
			.values({
				id: entry.sessionId,
				projectId: project,
				title,
				firstPrompt: fp ?? null,
				summary: summ ?? null,
				customTitle: null,
				messageCount: msgCount,
				gitBranch: branch ?? null,
				isSidechain: sidechain ? 1 : 0,
				createdAt,
				mtimeMs: entry.fileMtime,
				filePath: entry.fullPath,
			})
			.onConflictDoUpdate({
				target: schema.sessions.id,
				set: {
					title,
					firstPrompt: fp ?? null,
					summary: summ ?? null,
					messageCount: msgCount,
					gitBranch: branch ?? null,
					isSidechain: sidechain ? 1 : 0,
					mtimeMs: entry.fileMtime,
				},
			})
			.run();
	}

	// Update indexed_files
	db.insert(schema.indexedFiles)
		.values({
			path: indexPath,
			mtimeMs: fileStat.mtimeMs,
			sizeBytes: fileStat.size,
			indexedAt: Date.now(),
		})
		.onConflictDoUpdate({
			target: schema.indexedFiles.path,
			set: {mtimeMs: fileStat.mtimeMs, sizeBytes: fileStat.size, indexedAt: Date.now()},
		})
		.run();
}

export async function indexJsonlFile(db: IndexDb, filePath: string, project: string): Promise<void> {
	let fileStat: Awaited<ReturnType<typeof stat>>;
	try {
		fileStat = await stat(filePath);
	} catch {
		return;
	}

	const existing = db.select().from(schema.indexedFiles).where(eq(schema.indexedFiles.path, filePath)).get();
	if (existing && existing.mtimeMs === fileStat.mtimeMs) return;

	const sessionId = basename(filePath, '.jsonl');
	const planFilenames = new Set<string>();
	let customTitle: string | undefined;
	const textChunks: string[] = [];

	// Stream the file line-by-line to avoid loading entire JSONL into memory
	const rl = createInterface({
		input: createReadStream(filePath, {encoding: 'utf-8'}),
		crlfDelay: Infinity,
	});
	try {
		for await (const line of rl) {
			if (!line.trim()) continue;

			if (line.includes('file-history-snapshot')) {
				try {
					const parsed = JSON.parse(line);
					const result = FileHistorySnapshotSchema.safeParse(parsed);
					if (result.success) {
						for (const key of Object.keys(result.data.snapshot.trackedFileBackups)) {
							const match = PLAN_PATH_RE.exec(key);
							if (match?.[1]) planFilenames.add(match[1]);
						}
					}
				} catch {
					// skip
				}
			}

			if (line.includes('custom-title')) {
				try {
					const parsed = JSON.parse(line);
					const result = CustomTitleRecordSchema.safeParse(parsed);
					if (result.success) {
						customTitle = result.data.customTitle;
					}
				} catch {
					// skip
				}
			}

			// Extract text content for FTS indexing
			try {
				const obj = JSON.parse(line) as {
					type?: string;
					message?: {content?: string | Array<{type?: string; text?: string}>};
				};
				if (obj.type === 'user' || obj.type === 'assistant') {
					const content = obj.message?.content;
					if (typeof content === 'string') {
						textChunks.push(content);
					} else if (Array.isArray(content)) {
						for (const block of content) {
							if (block.type === 'text' && typeof block.text === 'string') {
								textChunks.push(block.text);
							}
						}
					}
				}
			} catch {
				// skip malformed lines
			}
		}
	} finally {
		rl.close();
	}

	// Upsert plan links
	for (const planFilename of planFilenames) {
		db.insert(schema.planSessions)
			.values({planFilename, sessionId, projectId: project})
			.onConflictDoNothing()
			.run();
	}

	// Update custom title if found
	if (customTitle) {
		const existingSession = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
		if (existingSession) {
			db.update(schema.sessions)
				.set({customTitle, title: customTitle})
				.where(eq(schema.sessions.id, sessionId))
				.run();
		}
	}

	// If session not in DB (no sessions-index.json existed), create from JSONL
	const sessionExists = db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get();
	if (!sessionExists) {
		const firstMsg = await readFirstUserMessage(filePath);
		const title = customTitle ?? extractSessionTitle(firstMsg ?? '', sessionId);
		const projectName = decodeProjectDir(project);

		// Ensure project exists
		db.insert(schema.projects)
			.values({id: project, name: projectName, projectPath: null, updatedAt: fileStat.mtimeMs})
			.onConflictDoUpdate({
				target: schema.projects.id,
				set: {updatedAt: fileStat.mtimeMs},
			})
			.run();

		db.insert(schema.sessions)
			.values({
				id: sessionId,
				projectId: project,
				title,
				firstPrompt: firstMsg ?? null,
				summary: null,
				customTitle: customTitle ?? null,
				messageCount: 0,
				gitBranch: null,
				isSidechain: 0,
				createdAt: fileStat.birthtimeMs,
				mtimeMs: fileStat.mtimeMs,
				filePath,
			})
			.run();
	}

	// Update message content FTS
	if (textChunks.length > 0) {
		const content = textChunks.join('\n');
		db.run(sql`DELETE FROM message_content_fts WHERE session_id = ${sessionId}`);
		db.run(sql`INSERT INTO message_content_fts(session_id, content) VALUES (${sessionId}, ${content})`);
	}

	// Update indexed_files
	db.insert(schema.indexedFiles)
		.values({
			path: filePath,
			mtimeMs: fileStat.mtimeMs,
			sizeBytes: fileStat.size,
			indexedAt: Date.now(),
		})
		.onConflictDoUpdate({
			target: schema.indexedFiles.path,
			set: {mtimeMs: fileStat.mtimeMs, sizeBytes: fileStat.size, indexedAt: Date.now()},
		})
		.run();
}

export async function indexSubagentFile(
	db: IndexDb,
	filePath: string,
	sessionId: string,
	project: string,
): Promise<void> {
	let fileStat: Awaited<ReturnType<typeof stat>>;
	try {
		fileStat = await stat(filePath);
	} catch {
		return;
	}

	const existing = db.select().from(schema.indexedFiles).where(eq(schema.indexedFiles.path, filePath)).get();
	if (existing && existing.mtimeMs === fileStat.mtimeMs) return;

	const agentFilename = basename(filePath, '.jsonl');
	const metaPath = filePath.replace(/\.jsonl$/, '.meta.json');
	let agentType: string | null = null;
	try {
		const meta = JSON.parse(await readFile(metaPath, 'utf-8')) as {agentType?: string};
		agentType = meta.agentType ?? null;
	} catch {
		// no meta file
	}

	let slug: string | null = null;
	const rl = createInterface({
		input: createReadStream(filePath, {encoding: 'utf-8'}),
		crlfDelay: Infinity,
	});
	try {
		for await (const line of rl) {
			if (!line.trim()) continue;
			try {
				const obj = JSON.parse(line) as {slug?: string};
				if (obj.slug) slug = obj.slug;
			} catch {
				// skip
			}
			break; // only first line
		}
	} finally {
		rl.close();
	}

	db.insert(schema.subagents)
		.values({
			id: agentFilename,
			sessionId,
			projectId: project,
			agentType,
			slug,
			filePath,
			mtimeMs: fileStat.mtimeMs,
		})
		.onConflictDoUpdate({
			target: schema.subagents.id,
			set: {agentType, slug, mtimeMs: fileStat.mtimeMs},
		})
		.run();

	db.insert(schema.indexedFiles)
		.values({path: filePath, mtimeMs: fileStat.mtimeMs, sizeBytes: fileStat.size, indexedAt: Date.now()})
		.onConflictDoUpdate({
			target: schema.indexedFiles.path,
			set: {mtimeMs: fileStat.mtimeMs, sizeBytes: fileStat.size, indexedAt: Date.now()},
		})
		.run();
}

let indexingInProgress = false;
export function isCurrentlyIndexing(): boolean {
	return indexingInProgress;
}

export async function fullScan(db: IndexDb, projectsDir: string): Promise<void> {
	indexingInProgress = true;
	try {
		let projectDirs: string[];
		try {
			projectDirs = await readdir(projectsDir);
		} catch {
			return;
		}

		for (const project of projectDirs) {
			const projectPath = join(projectsDir, project);
			try {
				const dirStat = await stat(projectPath);
				if (!dirStat.isDirectory()) continue;
			} catch {
				continue;
			}

			// Index sessions-index.json
			await indexSessionsIndex(db, projectPath, project);

			// Index JSONL files
			let files: string[];
			try {
				files = await readdir(projectPath);
			} catch {
				continue;
			}

			for (const file of files) {
				if (!file.endsWith('.jsonl')) continue;
				await indexJsonlFile(db, join(projectPath, file), project);
			}

			// Index subagents
			for (const file of files) {
				if (!file.endsWith('.jsonl')) continue;
				const sessionId = file.replace(/\.jsonl$/, '');
				const subagentsDir = join(projectPath, sessionId, 'subagents');
				let subFiles: string[];
				try {
					subFiles = await readdir(subagentsDir);
				} catch {
					continue;
				}
				for (const sf of subFiles) {
					if (!sf.startsWith('agent-') || !sf.endsWith('.jsonl')) continue;
					await indexSubagentFile(db, join(subagentsDir, sf), sessionId, project);
				}
			}
		}
	} finally {
		indexingInProgress = false;
	}
}

export async function indexFile(db: IndexDb, filePath: string, projectsDir: string): Promise<void> {
	// Determine what kind of file changed and index accordingly
	if (filePath.endsWith('sessions-index.json')) {
		const parts = filePath.split('/');
		const projectIdx = parts.lastIndexOf('sessions-index.json') - 1;
		if (projectIdx >= 0) {
			const project = parts[projectIdx]!;
			const projectDir = parts.slice(0, projectIdx + 1).join('/');
			await indexSessionsIndex(db, projectDir, project);
		}
		return;
	}

	if (filePath.endsWith('.jsonl')) {
		// Check if this is a subagent file
		if (filePath.includes('/subagents/') && basename(filePath).startsWith('agent-')) {
			const parts = filePath.split('/');
			const subagentsIdx = parts.indexOf('subagents');
			if (subagentsIdx >= 2) {
				const sessionId = parts[subagentsIdx - 1]!;
				// Walk back to find project dir
				const projectsDirParts = projectsDir.split('/');
				const projectsEndIdx = projectsDirParts.length;
				const project = parts[projectsEndIdx]!;
				if (project) {
					await indexSubagentFile(db, filePath, sessionId, project);
				}
			}
			return;
		}

		// Regular session JSONL
		const parts = filePath.split('/');
		const projectsDirParts = projectsDir.split('/');
		const project = parts[projectsDirParts.length];
		if (project) {
			await indexJsonlFile(db, filePath, project);
		}
	}
}
