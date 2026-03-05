import {createServer} from 'node:http';
import type {IncomingMessage, ServerResponse, RequestListener} from 'node:http';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {listPlans, readPlan} from './plans.js';
import {listMemories, readMemory, decodeProjectDir} from './memory.js';
import {renderMarkdown} from './renderer.js';
import {extractTitleFromContent} from './markdown-utils.js';
import {
	renderLandingPage,
	renderIndexPage,
	renderPlanPage,
	renderMemoryIndexPage,
	renderMemoryPage,
	render404Page,
} from './html.js';
import {addClient, broadcast, createWatcher, closeWatcher} from './watcher.js';

const PORT = Number(process.env['PORT'] ?? 8899);
const PLANS_DIR = process.env['PLANS_DIR'] ?? join(homedir(), '.claude', 'plans');
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

function sendHtml(res: ServerResponse, statusCode: number, html: string): void {
	res.writeHead(statusCode, {
		'Content-Type': 'text/html; charset=utf-8',
		'Cache-Control': 'no-cache',
	});
	res.end(html);
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
	res.writeHead(statusCode, {
		'Content-Type': 'application/json',
		'Cache-Control': 'no-cache',
	});
	res.end(JSON.stringify(data));
}

export async function createRequestHandler(plansDir: string, projectsDir: string): Promise<RequestListener> {
	return async (req: IncomingMessage, res: ServerResponse) => {
		const url = new URL(req.url ?? '/', `http://${req.headers['host'] ?? 'localhost'}`);
		const path = decodeURIComponent(url.pathname);
		const method = req.method ?? 'GET';

		if (method === 'GET' && (path === '/' || path === '/index.html')) {
			sendHtml(res, 200, renderLandingPage());
			return;
		}

		if (method === 'GET' && path === '/plans') {
			const plans = await listPlans(plansDir);
			sendHtml(res, 200, renderIndexPage(plans));
			return;
		}

		if (method === 'GET' && path.startsWith('/plan/')) {
			const filename = path.slice(6);
			const content = await readPlan(plansDir, filename);
			if (!content) {
				sendHtml(res, 404, render404Page());
				return;
			}
			const bodyHtml = await renderMarkdown(content);
			const title = extractTitleFromContent(content, filename);
			sendHtml(res, 200, renderPlanPage(title, bodyHtml));
			return;
		}

		if (method === 'GET' && path === '/memories') {
			const groups = await listMemories(projectsDir);
			sendHtml(res, 200, renderMemoryIndexPage(groups));
			return;
		}

		if (method === 'GET' && path.startsWith('/memory/')) {
			const rest = path.slice(8);
			const slashIdx = rest.lastIndexOf('/');
			if (slashIdx === -1) {
				sendHtml(res, 404, render404Page());
				return;
			}
			const project = rest.slice(0, slashIdx);
			const filename = rest.slice(slashIdx + 1);
			const content = await readMemory(projectsDir, project, filename);
			if (!content) {
				sendHtml(res, 404, render404Page());
				return;
			}
			const bodyHtml = await renderMarkdown(content);
			const title = extractTitleFromContent(content, filename);
			const projectName = decodeProjectDir(project);
			sendHtml(res, 200, renderMemoryPage(projectName, title, bodyHtml));
			return;
		}

		if (method === 'GET' && path === '/api/events') {
			res.writeHead(200, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			});
			res.write(':\n\n');
			addClient(res);

			const keepalive = setInterval(() => {
				res.write(':\n\n');
			}, 30000);

			res.on('close', () => {
				clearInterval(keepalive);
			});
			return;
		}

		if (method === 'POST' && path === '/api/notify') {
			broadcast();
			sendJson(res, 200, {ok: true});
			return;
		}

		if (method === 'GET' && path === '/api/count') {
			const plans = await listPlans(plansDir);
			sendJson(res, 200, {count: plans.length});
			return;
		}

		sendHtml(res, 404, render404Page());
	};
}

async function main(): Promise<void> {
	const handler = await createRequestHandler(PLANS_DIR, PROJECTS_DIR);
	const server = createServer(handler);

	createWatcher([PLANS_DIR, PROJECTS_DIR]);

	server.on('error', (err: NodeJS.ErrnoException) => {
		if (err.code === 'EADDRINUSE') {
			console.error(`Port ${PORT} is already in use. Kill the existing process: lsof -ti :${PORT} | xargs kill`);
			process.exit(1);
		}
		throw err;
	});

	server.listen(PORT, '0.0.0.0', () => {
		console.log(`Claude Plans server listening on http://0.0.0.0:${PORT}`);
		console.log(`Plans directory: ${PLANS_DIR}`);
		console.log(`Projects directory: ${PROJECTS_DIR}`);
	});

	const shutdown = async () => {
		console.log('\nShutting down...');
		await closeWatcher();
		server.close(() => {
			process.exit(0);
		});
	};

	process.on('SIGTERM', shutdown);
	process.on('SIGINT', shutdown);
}

const isMainModule = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (isMainModule) {
	main().catch((err) => {
		console.error('Failed to start server:', err);
		process.exit(1);
	});
}
