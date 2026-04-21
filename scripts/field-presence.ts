#!/usr/bin/env npx tsx
/**
 * Scan real JSONL files and report field presence rates per record type.
 * Usage: npx tsx scripts/field-presence.ts [--limit N] [--type typename]
 */

import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';

const args = process.argv.slice(2);
const limitIdx = args.indexOf('--limit');
const fileLimit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]!, 10) : Infinity;
const typeIdx = args.indexOf('--type');
const typeFilter = typeIdx >= 0 ? args[typeIdx + 1] : undefined;

const projectsDir = join(homedir(), '.claude', 'projects');

function findJsonlFiles(dir: string): string[] {
	const results: string[] = [];
	for (const entry of readdirSync(dir, {withFileTypes: true})) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...findJsonlFiles(full));
		} else if (entry.name.endsWith('.jsonl')) {
			results.push(full);
		}
	}
	return results;
}

interface TypeStats {
	total: number;
	fields: Map<string, number>;
}

const statsByType = new Map<string, TypeStats>();

function collectFieldPaths(obj: Record<string, unknown>, prefix: string): string[] {
	const paths: string[] = [];
	for (const [key, value] of Object.entries(obj)) {
		const fieldPath = prefix ? `${prefix}.${key}` : key;
		paths.push(fieldPath);
		if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
			paths.push(...collectFieldPaths(value as Record<string, unknown>, fieldPath));
		}
	}
	return paths;
}

const allFiles = findJsonlFiles(projectsDir);
const filesToProcess = allFiles.slice(0, fileLimit);

let totalRecords = 0;
let parseFails = 0;

for (const filePath of filesToProcess) {
	let content: string;
	try {
		content = readFileSync(filePath, 'utf-8');
	} catch {
		continue;
	}

	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		let obj: Record<string, unknown>;
		try {
			obj = JSON.parse(trimmed) as Record<string, unknown>;
		} catch {
			parseFails++;
			continue;
		}

		const recordType = obj['type'] as string | undefined;
		if (!recordType) continue;
		if (typeFilter && recordType !== typeFilter) continue;

		totalRecords++;

		let stats = statsByType.get(recordType);
		if (!stats) {
			stats = {total: 0, fields: new Map()};
			statsByType.set(recordType, stats);
		}
		stats.total++;

		for (const fieldPath of collectFieldPaths(obj, '')) {
			stats.fields.set(fieldPath, (stats.fields.get(fieldPath) ?? 0) + 1);
		}
	}
}

console.log(`Scanned ${filesToProcess.length} files, ${totalRecords} records, ${parseFails} parse failures\n`);

const sortedTypes = [...statsByType.entries()].sort((a, b) => b[1].total - a[1].total);

for (const [typeName, stats] of sortedTypes) {
	console.log(`\n${'='.repeat(70)}`);
	console.log(`type: "${typeName}"  (${stats.total} records)`);
	console.log(`${'='.repeat(70)}`);

	const fieldEntries = [...stats.fields.entries()]
		.filter(([f]) => f !== 'type')
		.sort((a, b) => {
			const aRate = a[1] / stats.total;
			const bRate = b[1] / stats.total;
			if (bRate !== aRate) return bRate - aRate;
			return a[0].localeCompare(b[0]);
		});

	const maxFieldLen = Math.max(...fieldEntries.map(([f]) => f.length), 5);

	console.log(`${'Field'.padEnd(maxFieldLen)}  ${'Present'.padStart(8)}  ${'Rate'.padStart(8)}  Status`);
	console.log(`${'-'.repeat(maxFieldLen)}  ${'-'.repeat(8)}  ${'-'.repeat(8)}  ------`);

	for (const [field, count] of fieldEntries) {
		const rate = count / stats.total;
		const pct = (rate * 100).toFixed(1).padStart(7) + '%';
		const status = rate === 1.0 ? '  ALWAYS' : rate === 0 ? '  NEVER' : rate >= 0.99 ? '  ~always' : rate <= 0.01 ? '  ~never' : '';
		console.log(`${field.padEnd(maxFieldLen)}  ${String(count).padStart(8)}  ${pct}  ${status}`);
	}
}
