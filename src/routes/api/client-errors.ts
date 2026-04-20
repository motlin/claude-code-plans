import {createFileRoute} from '@tanstack/react-router';

const LEVEL_PREFIXES: Record<string, string> = {
	log: '[browser:log]',
	info: '[browser:info]',
	warn: '[browser:warn]',
	error: '[browser:error]',
	unhandledrejection: '[browser:rejection]',
	onerror: '[browser:onerror]',
};

export const Route = createFileRoute('/api/client-errors')({
	server: {
		handlers: {
			POST: async ({request}) => {
				let body: unknown;
				try {
					body = await request.json();
				} catch {
					return new Response('invalid json', {status: 400});
				}

				const entries = Array.isArray(body) ? body : [body];
				for (const entry of entries) {
					const {level, messages, stack, url, line, col} = entry as {
						level?: string;
						messages?: unknown[];
						stack?: string;
						url?: string;
						line?: number;
						col?: number;
					};
					const prefix = LEVEL_PREFIXES[level ?? 'log'] ?? '[browser]';
					const parts = (messages ?? []).map((m) => (typeof m === 'string' ? m : JSON.stringify(m)));
					const msg = parts.join(' ');
					const location = url
						? ` (${url}${line != null ? `:${line}` : ''}${col != null ? `:${col}` : ''})`
						: '';

					if (level === 'error' || level === 'onerror' || level === 'unhandledrejection') {
						console.error(`${prefix} ${msg}${location}`);
						if (stack) console.error(`  ${stack.split('\n').join('\n  ')}`);
					} else if (level === 'warn') {
						console.warn(`${prefix} ${msg}${location}`);
					} else {
						console.log(`${prefix} ${msg}${location}`);
					}
				}

				return new Response('ok', {status: 200});
			},
		},
	},
});
