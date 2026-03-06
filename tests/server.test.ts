import {createServer} from 'node:http';
import {writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Server} from 'node:http';
import {createRequestHandler} from '../src/server.js';

const testDir = join(tmpdir(), 'claude-plans-server-test-' + process.pid);
const plansDir = join(testDir, 'plans');
const projectsDir = join(testDir, 'projects');

let server: Server;
let baseUrl: string;

beforeEach(async () => {
	mkdirSync(plansDir, {recursive: true});
	mkdirSync(projectsDir, {recursive: true});
	writeFileSync(join(plansDir, 'test-plan.md'), '# Test Plan\n\nSome content here.');

	const memDir = join(projectsDir, '-Users-craig-projects-app', 'memory');
	mkdirSync(memDir, {recursive: true});
	writeFileSync(join(memDir, 'MEMORY.md'), '# App Memory\n\nSome memory notes.');

	const handler = await createRequestHandler(plansDir, projectsDir);
	server = createServer(handler);

	await new Promise<void>((resolve) => {
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address();
			if (addr && typeof addr !== 'string') {
				baseUrl = `http://127.0.0.1:${addr.port}`;
			}
			resolve();
		});
	});
});

afterEach(async () => {
	await new Promise<void>((resolve, reject) => {
		server.close((err) => (err ? reject(err) : resolve()));
	});
	rmSync(testDir, {recursive: true, force: true});
});

describe('GET /', () => {
	it('returns landing page with links to plans and memories', async () => {
		const res = await fetch(`${baseUrl}/`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/html');
		const body = await res.text();
		expect(body).toContain('href="/plans"');
		expect(body).toContain('href="/memories"');
	});
});

describe('GET /css/github-markdown.css', () => {
	it('returns github markdown CSS with caching', async () => {
		const res = await fetch(`${baseUrl}/css/github-markdown.css`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/css');
		expect(res.headers.get('cache-control')).toContain('max-age=86400');
		const body = await res.text();
		expect(body).toContain('.markdown-body');
	});
});

describe('GET /plans', () => {
	it('returns plans index page', async () => {
		const res = await fetch(`${baseUrl}/plans`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/html');
		const body = await res.text();
		expect(body).toContain('Claude Plans');
		expect(body).toContain('Test Plan');
	});
});

describe('GET /plan/:filename', () => {
	it('returns rendered plan page', async () => {
		const res = await fetch(`${baseUrl}/plan/test-plan.md`);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain('Test Plan');
		expect(body).toContain('Some content here');
	});

	it('returns 404 for non-existent plan', async () => {
		const res = await fetch(`${baseUrl}/plan/nope.md`);
		expect(res.status).toBe(404);
	});

	it('rejects path traversal', async () => {
		const res = await fetch(`${baseUrl}/plan/../../../etc/passwd`);
		expect(res.status).toBe(404);
	});
});

describe('GET /memories', () => {
	it('returns memories index page grouped by project', async () => {
		const res = await fetch(`${baseUrl}/memories`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/html');
		const body = await res.text();
		expect(body).toContain('Claude Memories');
		expect(body).toContain('app');
		expect(body).toContain('MEMORY.md');
	});
});

describe('GET /memory/:project/:filename', () => {
	it('returns rendered memory page', async () => {
		const res = await fetch(`${baseUrl}/memory/-Users-craig-projects-app/MEMORY.md`);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain('App Memory');
		expect(body).toContain('Some memory notes');
	});

	it('returns 404 for non-existent memory', async () => {
		const res = await fetch(`${baseUrl}/memory/-Users-craig-projects-app/nope.md`);
		expect(res.status).toBe(404);
	});

	it('returns 404 for missing project', async () => {
		const res = await fetch(`${baseUrl}/memory/-Users-craig-projects-nope/MEMORY.md`);
		expect(res.status).toBe(404);
	});

	it('returns 404 when no filename in path', async () => {
		const res = await fetch(`${baseUrl}/memory/justproject`);
		expect(res.status).toBe(404);
	});
});

describe('GET /api/count', () => {
	it('returns plan count as JSON', async () => {
		const res = await fetch(`${baseUrl}/api/count`);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('application/json');
		const data = await res.json();
		expect(data).toEqual({count: 1});
	});
});

describe('POST /api/notify', () => {
	it('returns 200 and triggers broadcast', async () => {
		const res = await fetch(`${baseUrl}/api/notify`, {method: 'POST'});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toEqual({ok: true});
	});
});

describe('GET /api/events', () => {
	it('returns SSE stream', async () => {
		const controller = new AbortController();
		const res = await fetch(`${baseUrl}/api/events`, {signal: controller.signal});
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/event-stream');
		controller.abort();
	});
});

describe('404 handler', () => {
	it('returns 404 for unknown routes', async () => {
		const res = await fetch(`${baseUrl}/unknown`);
		expect(res.status).toBe(404);
	});
});
