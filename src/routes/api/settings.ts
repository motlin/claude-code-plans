import {createFileRoute} from '@tanstack/react-router';
import {SettingsResponse} from '../../lib/api/settings';

const SETTINGS_FILENAMES = ['settings.json', 'settings.local.json'] as const;

export const Route = createFileRoute('/api/settings')({
	server: {
		handlers: {
			GET: async ({request}: {request: Request}) => {
				const {homedir} = await import('node:os');
				const {join} = await import('node:path');
				const {readFile, stat} = await import('node:fs/promises');
				const claudeHome = join(homedir(), '.claude');

				const results: Array<{filename: string; path: string; exists: boolean; content: string}> = [];
				let latestMtime: Date | null = null;

				for (const filename of SETTINGS_FILENAMES) {
					const filePath = join(claudeHome, filename);
					try {
						const raw = await readFile(filePath, 'utf-8');
						const pretty = JSON.stringify(JSON.parse(raw), null, 2);
						results.push({filename, path: filePath, exists: true, content: pretty});
						const fileStat = await stat(filePath);
						if (!latestMtime || fileStat.mtime > latestMtime) {
							latestMtime = fileStat.mtime;
						}
					} catch {
						results.push({filename, path: filePath, exists: false, content: '{}'});
					}
				}

				if (latestMtime) {
					const ifModifiedSince = request.headers.get('If-Modified-Since');
					if (ifModifiedSince) {
						const since = new Date(ifModifiedSince).getTime();
						const mtimeFloor = Math.floor(latestMtime.getTime() / 1000) * 1000;
						if (!Number.isNaN(since) && since >= mtimeFloor) {
							return new Response(null, {
								status: 304,
								headers: {
									'Cache-Control': 'private, max-age=0, must-revalidate',
									'Last-Modified': latestMtime.toUTCString(),
								},
							});
						}
					}
				}

				const headers: Record<string, string> = {
					'Cache-Control': 'private, max-age=0, must-revalidate',
				};
				if (latestMtime) {
					headers['Last-Modified'] = latestMtime.toUTCString();
				}

				return Response.json(SettingsResponse.parse(results), {headers});
			},
		},
	},
});
