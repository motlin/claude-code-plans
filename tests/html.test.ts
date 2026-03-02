import type {PlanEntry} from '../src/plans.js';
import {renderIndexPage, renderPlanPage, render404Page} from '../src/html.js';

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
});

describe('renderPlanPage', () => {
	it('renders plan with title and body', () => {
		const html = renderPlanPage('My Plan', '<h1>My Plan</h1><p>Content</p>');
		expect(html).toContain('<!DOCTYPE html>');
		expect(html).toContain('<title>My Plan</title>');
		expect(html).toContain('<h1>My Plan</h1><p>Content</p>');
		expect(html).toContain('All Plans');
	});

	it('includes back link', () => {
		const html = renderPlanPage('Test', '<p>body</p>');
		expect(html).toContain('href="/"');
		expect(html).toContain('&larr;');
	});

	it('includes SSE auto-refresh for plan pages', () => {
		const html = renderPlanPage('Test', '<p>body</p>');
		expect(html).toContain('EventSource');
		expect(html).toContain('/api/events');
	});
});

describe('render404Page', () => {
	it('renders 404 page', () => {
		const html = render404Page();
		expect(html).toContain('404');
		expect(html).toContain('Not Found');
		expect(html).toContain('href="/"');
	});
});
