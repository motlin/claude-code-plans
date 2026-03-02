import {createServer} from 'node:http';
import {writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Server} from 'node:http';
import {createRequestHandler} from '../src/server.js';

const testDir = join(tmpdir(), 'claude-plans-server-test-' + process.pid);

let server: Server;
let baseUrl: string;

beforeEach(async () => {
	mkdirSync(testDir, {recursive: true});
	writeFileSync(join(testDir, 'test-plan.md'), '# Test Plan\n\nSome content here.');

	const handler = await createRequestHandler(testDir);
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
	it('returns index page with plans', async () => {
		const res = await fetch(`${baseUrl}/`);
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
