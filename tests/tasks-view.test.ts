import {describe, expect, it} from 'vitest';
import {extractTasks} from '../src/components/tasks-view';
import type {ClientToolCall} from '../src/components/tool-renderers/types';

function makeToolCall(name: string, input: ClientToolCall['input']): ClientToolCall {
	return {id: crypto.randomUUID(), name, input, param: '', result: '', sourceUuid: ''};
}

describe('extractTasks', () => {
	it('extracts tasks from TaskCreate calls', () => {
		const calls = [
			makeToolCall('TaskCreate', {subject: 'Build auth', description: 'Add JWT'}),
			makeToolCall('TaskCreate', {subject: 'Add tests'}),
		];
		const tasks = extractTasks(calls);
		expect(tasks).toHaveLength(2);
		expect(tasks[0]).toStrictEqual({id: '1', subject: 'Build auth', description: 'Add JWT', status: 'pending'});
		expect(tasks[1]).toStrictEqual({id: '2', subject: 'Add tests', description: '', status: 'pending'});
	});

	it('applies TaskUpdate status changes', () => {
		const calls = [
			makeToolCall('TaskCreate', {subject: 'Task A'}),
			makeToolCall('TaskUpdate', {taskId: '1', status: 'in_progress'}),
			makeToolCall('TaskUpdate', {taskId: '1', status: 'completed'}),
		];
		const tasks = extractTasks(calls);
		expect(tasks).toHaveLength(1);
		expect(tasks[0]!.status).toBe('completed');
	});

	it('ignores TaskUpdate for unknown task IDs', () => {
		const calls = [
			makeToolCall('TaskCreate', {subject: 'Task A'}),
			makeToolCall('TaskUpdate', {taskId: '99', status: 'completed'}),
		];
		const tasks = extractTasks(calls);
		expect(tasks[0]!.status).toBe('pending');
	});

	it('returns empty array when no task calls exist', () => {
		const calls = [makeToolCall('Bash', {command: 'echo hi'}), makeToolCall('Read', {file_path: '/tmp/foo'})];
		expect(extractTasks(calls)).toStrictEqual([]);
	});

	it('ignores invalid status values in TaskUpdate', () => {
		const calls = [
			makeToolCall('TaskCreate', {subject: 'Task A'}),
			makeToolCall('TaskUpdate', {taskId: '1', status: 'invalid_status'}),
		];
		const tasks = extractTasks(calls);
		expect(tasks[0]!.status).toBe('pending');
	});
});
