import type {PlanEntry} from '../src/plans.js';
import type {ProjectGroup} from '../src/memory.js';
import {
	renderIndexPage,
	renderPlanPage,
	render404Page,
	renderLandingPage,
	renderMemoryIndexPage,
	renderMemoryPage,
} from '../src/html.js';

describe('renderLandingPage', () => {
	it('renders landing page with links to plans and memories', () => {
		const html = renderLandingPage();
		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('href="/plans"');
		expect(html).toContain('href="/memories"');
		expect(html).toContain('Plans');
		expect(html).toContain('Memories');
	});

	it('includes SSE auto-refresh', () => {
		const html = renderLandingPage();
		expect(html).toContain('EventSource');
		expect(html).toContain('content-updated');
	});
});

describe('renderIndexPage', () => {
	it('renders page with plan entries', () => {
		const plans: PlanEntry[] = [
			{filename: 'plan-a.md', title: 'Plan A', mtime: new Date('2025-03-01T12:00:00Z')},
			{filename: 'plan-b.md', title: 'Plan B', mtime: new Date('2025-02-28T12:00:00Z')},
		];
		const html = renderIndexPage(plans);
		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('Claude Plans');
		expect(html).toContain('Plan A');
		expect(html).toContain('Plan B');
		expect(html).toContain('/plan/plan-a.md');
		expect(html).toContain('/plan/plan-b.md');
		expect(html).toContain('2 plans');
	});

	it('renders empty state', () => {
		const html = renderIndexPage([]);
		expect(html).toContain('No plans found');
		expect(html).toContain('0 plans');
	});

	it('renders singular plan count', () => {
		const plans: PlanEntry[] = [{filename: 'solo.md', title: 'Solo', mtime: new Date()}];
		const html = renderIndexPage(plans);
		expect(html).toContain('1 plan');
		expect(html).not.toContain('1 plans');
	});

	it('uses SSE EventSource instead of polling', () => {
		const plans: PlanEntry[] = [{filename: 'test.md', title: 'Test', mtime: new Date()}];
		const html = renderIndexPage(plans);
		expect(html).toContain('EventSource');
		expect(html).toContain('/api/events');
		expect(html).not.toContain('setInterval');
	});

	it('escapes HTML in titles', () => {
		const plans: PlanEntry[] = [{filename: 'xss.md', title: '<script>alert("xss")</script>', mtime: new Date()}];
		const html = renderIndexPage(plans);
		expect(html).not.toContain('<script>alert');
		expect(html).toContain('&lt;script&gt;');
	});

	it('shows NEW badge for recently modified plans', () => {
		const plans: PlanEntry[] = [{filename: 'new.md', title: 'New Plan', mtime: new Date()}];
		const html = renderIndexPage(plans);
		expect(html).toContain('NEW');
		expect(html).toContain('new-marker');
	});

	it('includes home link', () => {
		const html = renderIndexPage([]);
		expect(html).toContain('href="/"');
	});
});

describe('renderPlanPage', () => {
	it('renders plan with title and body', () => {
		const html = renderPlanPage('My Plan', '<h1>My Plan</h1><p>Content</p>');
		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('<title>My Plan</title>');
		expect(html).toContain('<h1>My Plan</h1><p>Content</p>');
		expect(html).toContain('All Plans');
	});

	it('includes back link to /plans', () => {
		const html = renderPlanPage('Test', '<p>body</p>');
		expect(html).toContain('href="/plans"');
		expect(html).toContain('&larr;');
	});

	it('includes SSE auto-refresh for plan pages', () => {
		const html = renderPlanPage('Test', '<p>body</p>');
		expect(html).toContain('EventSource');
		expect(html).toContain('/api/events');
	});
});

describe('renderMemoryIndexPage', () => {
	it('renders memory index with project groups', () => {
		const groups: ProjectGroup[] = [
			{
				project: '-Users-craig-projects-app',
				projectName: 'app',
				memories: [
					{
						filename: 'MEMORY.md',
						title: 'Memory',
						mtime: new Date(),
						project: '-Users-craig-projects-app',
						projectName: 'app',
					},
				],
			},
		];
		const html = renderMemoryIndexPage(groups);
		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('app');
		expect(html).toContain('MEMORY.md');
		expect(html).toContain('/memory/-Users-craig-projects-app/MEMORY.md');
	});

	it('renders empty state', () => {
		const html = renderMemoryIndexPage([]);
		expect(html).toContain('No memory files found');
	});

	it('includes home link', () => {
		const html = renderMemoryIndexPage([]);
		expect(html).toContain('href="/"');
	});

	it('includes SSE auto-refresh', () => {
		const html = renderMemoryIndexPage([]);
		expect(html).toContain('EventSource');
		expect(html).toContain('content-updated');
	});
});

describe('renderMemoryPage', () => {
	it('renders memory page with title and body', () => {
		const html = renderMemoryPage('app', 'Memory', '<h1>Memory</h1><p>Content</p>');
		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('<title>Memory</title>');
		expect(html).toContain('<h1>Memory</h1><p>Content</p>');
	});

	it('includes back link to /memories', () => {
		const html = renderMemoryPage('app', 'Memory', '<p>body</p>');
		expect(html).toContain('href="/memories"');
		expect(html).toContain('&larr;');
	});

	it('shows project name context', () => {
		const html = renderMemoryPage('my-project', 'Memory', '<p>body</p>');
		expect(html).toContain('my-project');
	});

	it('includes SSE auto-refresh', () => {
		const html = renderMemoryPage('app', 'Memory', '<p>body</p>');
		expect(html).toContain('EventSource');
		expect(html).toContain('content-updated');
	});
});

describe('dark mode', () => {
	it('includes prefers-color-scheme: dark media query in all pages', () => {
		const landing = renderLandingPage();
		const index = renderIndexPage([]);
		const plan = renderPlanPage('Test', '<p>body</p>');
		const memoryIndex = renderMemoryIndexPage([]);
		const memory = renderMemoryPage('app', 'Test', '<p>body</p>');
		const notFound = render404Page();

		for (const html of [landing, index, plan, memoryIndex, memory, notFound]) {
			expect(html).toContain('prefers-color-scheme: dark');
		}
	});
});

describe('favicon', () => {
	it('includes inline SVG favicon in all pages', () => {
		const landing = renderLandingPage();
		const index = renderIndexPage([]);
		const plan = renderPlanPage('Test', '<p>body</p>');
		const memoryIndex = renderMemoryIndexPage([]);
		const memory = renderMemoryPage('app', 'Test', '<p>body</p>');
		const notFound = render404Page();

		for (const html of [landing, index, plan, memoryIndex, memory, notFound]) {
			expect(html).toContain('rel="icon"');
			expect(html).toContain('image/svg+xml');
		}
	});
});

describe('render404Page', () => {
	it('renders 404 page', () => {
		const html = render404Page();
		expect(html).toContain('404');
		expect(html).toContain('Not Found');
		expect(html).toContain('href="/"');
	});

	it('uses generic page wording', () => {
		const html = render404Page();
		expect(html).toContain('page');
		expect(html).not.toContain('The requested plan');
	});
});
