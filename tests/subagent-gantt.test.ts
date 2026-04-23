import {describe, expect, it} from 'vitest';
import {layoutSwimlanes, type SwimlaneLayout} from '../src/components/subagent-gantt';
import type {DbSubagent} from '../src/lib/db/queries';

function makeAgent(overrides: Partial<DbSubagent> & {id: string}): DbSubagent {
	return {
		sessionId: 'sess-1',
		projectId: 'proj-1',
		parentAgentId: null,
		agentType: null,
		slug: null,
		description: null,
		startedAt: null,
		finishedAt: null,
		filePath: `/path/${overrides.id}.jsonl`,
		mtimeMs: 1000,
		...overrides,
	};
}

describe('layoutSwimlanes', () => {
	it('returns empty layout when no agents have timing', () => {
		const layout = layoutSwimlanes([makeAgent({id: 'a'})]);
		expect(layout.lanes).toStrictEqual([]);
		expect(layout.startMs).toBe(0);
		expect(layout.endMs).toBe(0);
	});

	it('returns empty layout for empty input', () => {
		const layout = layoutSwimlanes([]);
		expect(layout.lanes).toStrictEqual([]);
	});

	it('produces one lane per agent with timing', () => {
		const agents = [
			makeAgent({id: 'a', startedAt: '1999-12-31T00:00:00.000Z', finishedAt: '1999-12-31T00:00:10.000Z'}),
			makeAgent({id: 'b', startedAt: '1999-12-31T00:00:15.000Z', finishedAt: '1999-12-31T00:00:25.000Z'}),
		];
		const layout = layoutSwimlanes(agents);
		expect(layout.lanes.map((l) => l.agent.id)).toStrictEqual(['a', 'b']);
	});

	it('computes overall time bounds', () => {
		const agents = [
			makeAgent({id: 'a', startedAt: '1999-12-31T00:00:00.000Z', finishedAt: '1999-12-31T00:00:10.000Z'}),
			makeAgent({id: 'b', startedAt: '1999-12-31T00:00:15.000Z', finishedAt: '1999-12-31T00:00:25.000Z'}),
		];
		const layout = layoutSwimlanes(agents);
		expect(layout.startMs).toBe(new Date('1999-12-31T00:00:00.000Z').getTime());
		expect(layout.endMs).toBe(new Date('1999-12-31T00:00:25.000Z').getTime());
		expect(layout.totalMs).toBe(25000);
	});

	it('orders lanes by start time, then by depth for tiebreaks', () => {
		const agents = [
			makeAgent({
				id: 'parent',
				startedAt: '1999-12-31T00:00:00.000Z',
				finishedAt: '1999-12-31T00:00:30.000Z',
			}),
			makeAgent({
				id: 'late',
				startedAt: '1999-12-31T00:00:20.000Z',
				finishedAt: '1999-12-31T00:00:25.000Z',
			}),
			makeAgent({
				id: 'child',
				parentAgentId: 'parent',
				startedAt: '1999-12-31T00:00:05.000Z',
				finishedAt: '1999-12-31T00:00:10.000Z',
			}),
		];
		const layout = layoutSwimlanes(agents);
		expect(layout.lanes.map((l) => l.agent.id)).toStrictEqual(['parent', 'child', 'late']);
	});

	it('marks parent lane as hatched while child runs', () => {
		const agents = [
			makeAgent({
				id: 'parent',
				startedAt: '1999-12-31T00:00:00.000Z',
				finishedAt: '1999-12-31T00:00:30.000Z',
			}),
			makeAgent({
				id: 'child',
				parentAgentId: 'parent',
				startedAt: '1999-12-31T00:00:10.000Z',
				finishedAt: '1999-12-31T00:00:20.000Z',
			}),
		];
		const layout = layoutSwimlanes(agents);
		const parentLane = layout.lanes.find((l) => l.agent.id === 'parent')!;
		expect(parentLane.waiting).toStrictEqual([
			{
				startMs: new Date('1999-12-31T00:00:10.000Z').getTime(),
				endMs: new Date('1999-12-31T00:00:20.000Z').getTime(),
			},
		]);
	});

	it('merges overlapping waiting periods on parent', () => {
		const agents = [
			makeAgent({
				id: 'parent',
				startedAt: '1999-12-31T00:00:00.000Z',
				finishedAt: '1999-12-31T00:00:30.000Z',
			}),
			makeAgent({
				id: 'c1',
				parentAgentId: 'parent',
				startedAt: '1999-12-31T00:00:05.000Z',
				finishedAt: '1999-12-31T00:00:15.000Z',
			}),
			makeAgent({
				id: 'c2',
				parentAgentId: 'parent',
				startedAt: '1999-12-31T00:00:10.000Z',
				finishedAt: '1999-12-31T00:00:20.000Z',
			}),
		];
		const layout = layoutSwimlanes(agents);
		const parentLane = layout.lanes.find((l) => l.agent.id === 'parent')!;
		expect(parentLane.waiting).toStrictEqual([
			{
				startMs: new Date('1999-12-31T00:00:05.000Z').getTime(),
				endMs: new Date('1999-12-31T00:00:20.000Z').getTime(),
			},
		]);
	});

	it('keeps parallel children at the same start position', () => {
		const agents = [
			makeAgent({
				id: 'parent',
				startedAt: '1999-12-31T00:00:00.000Z',
				finishedAt: '1999-12-31T00:00:30.000Z',
			}),
			makeAgent({
				id: 'p1',
				parentAgentId: 'parent',
				startedAt: '1999-12-31T00:00:10.000Z',
				finishedAt: '1999-12-31T00:00:20.000Z',
			}),
			makeAgent({
				id: 'p2',
				parentAgentId: 'parent',
				startedAt: '1999-12-31T00:00:10.000Z',
				finishedAt: '1999-12-31T00:00:25.000Z',
			}),
		];
		const layout = layoutSwimlanes(agents);
		const p1 = layout.lanes.find((l) => l.agent.id === 'p1')!;
		const p2 = layout.lanes.find((l) => l.agent.id === 'p2')!;
		expect(p1.startMs).toBe(p2.startMs);
		expect(p1.depth).toBe(p2.depth);
	});

	it('records depth for nested agents', () => {
		const agents = [
			makeAgent({
				id: 'root',
				startedAt: '1999-12-31T00:00:00.000Z',
				finishedAt: '1999-12-31T00:01:00.000Z',
			}),
			makeAgent({
				id: 'mid',
				parentAgentId: 'root',
				startedAt: '1999-12-31T00:00:10.000Z',
				finishedAt: '1999-12-31T00:00:40.000Z',
			}),
			makeAgent({
				id: 'leaf',
				parentAgentId: 'mid',
				startedAt: '1999-12-31T00:00:15.000Z',
				finishedAt: '1999-12-31T00:00:25.000Z',
			}),
		];
		const layout = layoutSwimlanes(agents);
		const root = layout.lanes.find((l) => l.agent.id === 'root')!;
		const mid = layout.lanes.find((l) => l.agent.id === 'mid')!;
		const leaf = layout.lanes.find((l) => l.agent.id === 'leaf')!;
		expect(root.depth).toBe(0);
		expect(mid.depth).toBe(1);
		expect(leaf.depth).toBe(2);
	});

	it('skips agents with missing timing but keeps siblings', () => {
		const agents = [
			makeAgent({id: 'a', startedAt: '1999-12-31T00:00:00.000Z', finishedAt: '1999-12-31T00:00:10.000Z'}),
			makeAgent({id: 'b'}), // no timing
			makeAgent({id: 'c', startedAt: '1999-12-31T00:00:15.000Z', finishedAt: '1999-12-31T00:00:25.000Z'}),
		];
		const layout = layoutSwimlanes(agents);
		expect(layout.lanes.map((l) => l.agent.id)).toStrictEqual(['a', 'c']);
	});

	it('produces tick marks proportional to total duration', () => {
		const agents = [
			makeAgent({id: 'a', startedAt: '1999-12-31T00:00:00.000Z', finishedAt: '1999-12-31T00:01:00.000Z'}),
		];
		const layout: SwimlaneLayout = layoutSwimlanes(agents);
		expect(layout.ticks.length).toBeGreaterThanOrEqual(2);
		expect(layout.ticks[0]!.offsetMs).toBe(0);
		expect(layout.ticks[layout.ticks.length - 1]!.offsetMs).toBeLessThanOrEqual(layout.totalMs);
	});
});
