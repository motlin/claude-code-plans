import {describe, expect, it} from 'vitest';
import {layoutGraph, type GraphTask} from '../src/components/task-dependency-graph';

function makeTask(id: string, overrides: Partial<GraphTask> = {}): GraphTask {
	return {
		taskId: id,
		projectDir: 'test-project',
		subject: `Task ${id}`,
		status: 'pending',
		blocks: [],
		blockedBy: [],
		...overrides,
	};
}

describe('layoutGraph', () => {
	it('returns empty for no tasks', () => {
		const {nodes, width, height} = layoutGraph([]);
		expect(nodes).toStrictEqual([]);
		expect(width).toBe(300);
		expect(height).toBe(200);
	});

	it('places a single task at layer 0', () => {
		const {nodes} = layoutGraph([makeTask('1')]);
		expect(nodes.map((n) => n.layer)).toStrictEqual([0]);
	});

	it('places independent tasks in the same layer', () => {
		const {nodes} = layoutGraph([makeTask('1'), makeTask('2'), makeTask('3')]);
		expect(nodes.every((n) => n.layer === 0)).toBe(true);
		// They should have different y positions
		const ys = nodes.map((n) => n.y);
		expect(new Set(ys).size).toBe(3);
	});

	it('places dependent tasks in successive layers', () => {
		const tasks = [
			makeTask('1', {blocks: ['2']}),
			makeTask('2', {blockedBy: ['1'], blocks: ['3']}),
			makeTask('3', {blockedBy: ['2']}),
		];
		const {nodes} = layoutGraph(tasks);
		const layerOf = new Map(nodes.map((n) => [n.task.taskId, n.layer]));
		expect(layerOf.get('1')).toBe(0);
		expect(layerOf.get('2')).toBe(1);
		expect(layerOf.get('3')).toBe(2);
	});

	it('handles diamond dependencies', () => {
		// A -> B, A -> C, B -> D, C -> D
		const tasks = [
			makeTask('A', {blocks: ['B', 'C']}),
			makeTask('B', {blockedBy: ['A'], blocks: ['D']}),
			makeTask('C', {blockedBy: ['A'], blocks: ['D']}),
			makeTask('D', {blockedBy: ['B', 'C']}),
		];
		const {nodes} = layoutGraph(tasks);
		const layerOf = new Map(nodes.map((n) => [n.task.taskId, n.layer]));
		expect(layerOf.get('A')).toBe(0);
		expect(layerOf.get('B')).toBe(1);
		expect(layerOf.get('C')).toBe(1);
		expect(layerOf.get('D')).toBe(2);
	});

	it('ignores blockedBy references to tasks not in the set', () => {
		const tasks = [makeTask('1', {blockedBy: ['999']}), makeTask('2', {blockedBy: ['1']})];
		const {nodes} = layoutGraph(tasks);
		const layerOf = new Map(nodes.map((n) => [n.task.taskId, n.layer]));
		// Task 1 blocked by missing 999 → treated as root
		expect(layerOf.get('1')).toBe(0);
		expect(layerOf.get('2')).toBe(1);
	});

	it('nodes in later layers have greater x positions', () => {
		const tasks = [makeTask('1', {blocks: ['2']}), makeTask('2', {blockedBy: ['1']})];
		const {nodes} = layoutGraph(tasks);
		const node1 = nodes.find((n) => n.task.taskId === '1')!;
		const node2 = nodes.find((n) => n.task.taskId === '2')!;
		expect(node2.x).toBeGreaterThan(node1.x);
	});
});
