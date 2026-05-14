import {readdir, readFile, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {extractTitle} from './markdown-utils.js';

interface PlanEntry {
	filename: string;
	title: string;
	mtime: Date;
}

export async function listPlans(plansDir: string): Promise<PlanEntry[]> {
	let entries: string[];
	try {
		entries = await readdir(plansDir);
	} catch {
		return [];
	}

	const mdFiles = entries.filter((f) => f.endsWith('.md'));

	const plans: PlanEntry[] = await Promise.all(
		mdFiles.map(async (filename) => {
			const filePath = join(plansDir, filename);
			const fileStat = await stat(filePath);
			const title = await extractTitle(filePath, filename);
			return {
				filename,
				title,
				mtime: fileStat.mtime,
			};
		}),
	);

	plans.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
	return plans;
}

export async function readPlan(plansDir: string, filename: string): Promise<string | null> {
	if (filename.includes('..') || filename.includes('/') || filename.startsWith('/') || !filename.endsWith('.md')) {
		return null;
	}

	try {
		const filePath = join(plansDir, filename);
		return await readFile(filePath, 'utf-8');
	} catch {
		return null;
	}
}

export async function getPlanMtime(plansDir: string, filename: string): Promise<Date | null> {
	if (filename.includes('..') || filename.includes('/') || filename.startsWith('/') || !filename.endsWith('.md')) {
		return null;
	}

	try {
		const filePath = join(plansDir, filename);
		const fileStat = await stat(filePath);
		return fileStat.mtime;
	} catch {
		return null;
	}
}

export async function writePlan(plansDir: string, filename: string, content: string): Promise<boolean> {
	if (filename.includes('..') || filename.includes('/') || !filename.endsWith('.md')) return false;
	await writeFile(join(plansDir, filename), content, 'utf-8');
	return true;
}

/**
 * Build a 304 Not Modified response when the client's `If-None-Match` header
 * matches the row's current sha. Returns null if no 304 should be sent —
 * either the client did not send the header, the row is missing, or the
 * shas differ. Centralized so the conditional-GET behavior is testable
 * without spinning up the TanStack route runtime.
 */
export function buildPlanNotModifiedResponse(ifNoneMatch: string | null, row: {sha: string} | null): Response | null {
	if (!row) return null;
	const etag = `"${row.sha}"`;
	if (!ifNoneMatch || ifNoneMatch !== etag) return null;
	return new Response(null, {
		status: 304,
		headers: {
			'Cache-Control': 'private, max-age=0, must-revalidate',
			ETag: etag,
		},
	});
}
