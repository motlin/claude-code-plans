import {readdir, readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';

export interface PlanEntry {
	filename: string;
	title: string;
	mtime: Date;
}

function humanizeFilename(filename: string): string {
	return filename
		.replace(/\.md$/, '')
		.replace(/[-_]/g, ' ')
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

async function extractTitle(filePath: string, filename: string): Promise<string> {
	try {
		const content = await readFile(filePath, 'utf-8');
		const firstLine = content.split('\n')[0]?.trim();
		if (firstLine?.startsWith('# ')) {
			return firstLine.slice(2);
		}
	} catch {
		// Fall through to default
	}
	return humanizeFilename(filename);
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
