import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {JsonlRecordSchema} from '../src/lib/schemas';

describe('JsonlRecordSchema against disk', () => {
	const projectsDir = join(homedir(), '.claude', 'projects');

	it('validates every line in every JSONL file on disk', () => {
		let projectDirs: string[];
		try {
			projectDirs = readdirSync(projectsDir);
		} catch {
			return;
		}

		let totalFiles = 0;
		let totalLines = 0;
		const failures: string[] = [];

		for (const projectDir of projectDirs) {
			const projectPath = join(projectsDir, projectDir);
			let st: ReturnType<typeof statSync>;
			try {
				st = statSync(projectPath);
			} catch {
				continue;
			}
			if (!st.isDirectory()) continue;

			const files = readdirSync(projectPath).filter((f) => f.endsWith('.jsonl'));
			for (const file of files) {
				const filePath = join(projectPath, file);
				totalFiles++;

				const raw = readFileSync(filePath, 'utf-8');
				const lines = raw.split('\n');

				for (let i = 0; i < lines.length; i++) {
					const line = lines[i]!.trim();
					if (!line) continue;

					let parsed: unknown;
					try {
						parsed = JSON.parse(line);
					} catch {
						// Skip unparseable lines (partial writes, etc.)
						continue;
					}

					totalLines++;

					const result = JsonlRecordSchema.safeParse(parsed);
					if (!result.success) {
						const issues = result.error.issues
							.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
							.join('\n');
						failures.push(`${projectDir}/${file}:${i + 1}\n${issues}`);
					}
				}
			}
		}

		console.log(`Scanned ${totalFiles} files, ${totalLines} lines`);

		if (failures.length > 0) {
			// Show first 50 unique failure patterns to avoid overwhelming output
			const uniquePatterns = new Map<string, string>();
			for (const failure of failures) {
				const issueLines = failure.split('\n').slice(1).join('\n');
				if (!uniquePatterns.has(issueLines)) {
					uniquePatterns.set(issueLines, failure);
				}
			}

			const sample = [...uniquePatterns.values()].slice(0, 50);
			throw new Error(
				`${failures.length} lines failed validation (${uniquePatterns.size} unique patterns):\n\n${sample.join('\n\n')}`,
			);
		}

		expect(totalLines).toBeGreaterThan(0);
	}, 120000);
});
