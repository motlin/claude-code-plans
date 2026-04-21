import {describe, expect, it} from 'vitest';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';

const ROUTES_DIR = join(__dirname, '..', 'src', 'routes');
const LIB_DIR = join(__dirname, '..', 'src', 'lib');

function collectFiles(dir: string, ext: string[]): string[] {
	const results: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			results.push(...collectFiles(full, ext));
		} else if (ext.some((e) => full.endsWith(e))) {
			results.push(full);
		}
	}
	return results;
}

const TOP_LEVEL_IMPORT_RE = /^import\s+(?!type\s).*from\s+['"]([^'"]+)['"]/gm;
const SERVER_ONLY_ROUTE_RE = /server\s*:\s*\{\s*handlers\s*:/;

function getTopLevelValueImports(source: string): string[] {
	const modules: string[] = [];
	for (const match of source.matchAll(TOP_LEVEL_IMPORT_RE)) {
		modules.push(match[1]!);
	}
	return modules;
}

function findServerOnlyLibModules(): Set<string> {
	const serverOnly = new Set<string>();
	for (const file of collectFiles(LIB_DIR, ['.ts'])) {
		const source = readFileSync(file, 'utf-8');
		const imports = getTopLevelValueImports(source);
		if (imports.some((m) => m === 'node:fs/promises' || m === 'node:fs')) {
			const rel = relative(join(__dirname, '..', 'src'), file).replace(/\.ts$/, '');
			serverOnly.add(rel);
		}
	}
	return serverOnly;
}

const SERVER_ONLY_NODE_MODULES = new Set(['node:fs', 'node:fs/promises']);

describe('route files must not have top-level imports from server-only modules', () => {
	const serverOnlyLibs = findServerOnlyLibModules();
	const routeFiles = collectFiles(ROUTES_DIR, ['.ts', '.tsx']);

	for (const routeFile of routeFiles) {
		const label = relative(join(__dirname, '..'), routeFile);

		it(label, () => {
			const source = readFileSync(routeFile, 'utf-8');

			if (SERVER_ONLY_ROUTE_RE.test(source) && !source.includes('createServerFn')) {
				return;
			}

			const imports = getTopLevelValueImports(source);
			const violations: string[] = [];

			for (const mod of imports) {
				if (SERVER_ONLY_NODE_MODULES.has(mod)) {
					violations.push(`direct import of '${mod}'`);
					continue;
				}

				const resolved = mod.startsWith('.')
					? relative(join(__dirname, '..', 'src'), join(routeFile, '..', mod).replace(/\.(ts|tsx)$/, ''))
					: null;

				if (resolved && serverOnlyLibs.has(resolved)) {
					violations.push(`imports '${mod}' which uses node:fs/promises`);
				}
			}

			if (violations.length > 0) {
				expect.fail(
					`${label} has top-level value imports from server-only modules:\n` +
						violations.map((v) => `  - ${v}`).join('\n') +
						'\n\nMove these imports inside createServerFn handlers using dynamic import().',
				);
			}
		});
	}
});
