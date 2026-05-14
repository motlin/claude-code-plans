import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openTestDb, type AppDb} from '../src/lib/db/connection';
import * as schema from '../src/lib/db/schema';
import {DOMAIN_EVENTS} from '../src/lib/hook-events';

/**
 * TDD red-phase tests for the pending-approvals in-memory cache module.
 *
 * The module under test is `src/lib/db/pending-approvals-cache.ts` (which does
 * not yet exist). It is responsible for keeping an in-memory snapshot of every
 * actionable session (one whose latest ExitPlanMode/AskUserQuestion tool_use
 * has no matching tool_result) and broadcasting domain-level deltas through
 * the SSE channel as JSONL files change.
 *
 * Mocks `broadcastTyped` from `src/lib/watcher` so we can assert the exact
 * events emitted when entries are added, updated, or resolved.
 */

const broadcastSpy = vi.fn();

vi.mock('../src/lib/watcher', () => ({
	broadcastTyped: (...args: unknown[]) => broadcastSpy(...args),
}));

function jsonl(...lines: Record<string, unknown>[]): string {
	return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

const PROJECT_ID = '-Users-craig-projects-app';
const PROJECT_NAME = 'app';

describe('pending-approvals-cache', () => {
	const testDir = join(tmpdir(), 'claude-pending-approvals-cache-test-' + process.pid);
	let projectsDir: string;
	let projectDir: string;
	let db: AppDb;

	beforeEach(() => {
		broadcastSpy.mockReset();
		mkdirSync(testDir, {recursive: true});
		projectsDir = join(testDir, 'projects');
		projectDir = join(projectsDir, PROJECT_ID);
		mkdirSync(projectDir, {recursive: true});
		db = openTestDb();
	});

	afterEach(() => {
		db.close();
		rmSync(testDir, {recursive: true, force: true});
	});

	function writeJsonl(name: string, contents: string): string {
		const path = join(projectDir, name);
		writeFileSync(path, contents);
		return path;
	}

	function seedProject(): void {
		db.index
			.insert(schema.projects)
			.values({id: PROJECT_ID, name: PROJECT_NAME, projectPath: '/Users/craig/projects/app', updatedAt: 1})
			.run();
	}

	function seedSession(sessionId: string, filePath: string): void {
		db.index
			.insert(schema.sessions)
			.values({
				id: sessionId,
				projectId: PROJECT_ID,
				title: sessionId,
				firstPrompt: null,
				summary: null,
				customTitle: null,
				messageCount: 0,
				gitBranch: null,
				cwd: null,
				isSidechain: 0,
				createdAt: 1,
				mtimeMs: 1,
				filePath,
			})
			.run();
	}

	it('initPendingApprovalsCache populates the cache from a seeded DB with one blocked and one resolved session', async () => {
		seedProject();

		const blockedSessionId = 'sess-blocked';
		const blockedPath = writeJsonl(
			`${blockedSessionId}.jsonl`,
			jsonl({
				type: 'assistant',
				sessionId: blockedSessionId,
				timestamp: '2026-05-14T12:00:00.000Z',
				message: {
					role: 'assistant',
					content: [
						{
							type: 'tool_use',
							id: 'toolu_blocked',
							name: 'ExitPlanMode',
							input: {plan: '## Plan', planFilePath: '/Users/craig/.claude/plans/alpha.md'},
						},
					],
				},
			}),
		);
		seedSession(blockedSessionId, blockedPath);

		const resolvedSessionId = 'sess-resolved';
		const resolvedPath = writeJsonl(
			`${resolvedSessionId}.jsonl`,
			jsonl(
				{
					type: 'assistant',
					sessionId: resolvedSessionId,
					timestamp: '2026-05-14T11:00:00.000Z',
					message: {
						role: 'assistant',
						content: [{type: 'tool_use', id: 'toolu_done', name: 'ExitPlanMode', input: {plan: '## P'}}],
					},
				},
				{
					type: 'user',
					sessionId: resolvedSessionId,
					timestamp: '2026-05-14T11:01:00.000Z',
					message: {
						role: 'user',
						content: [
							{type: 'tool_result', tool_use_id: 'toolu_done', content: 'User has approved your plan.'},
						],
					},
				},
			),
		);
		seedSession(resolvedSessionId, resolvedPath);

		const {initPendingApprovalsCache, getPendingApprovals} = await import('../src/lib/db/pending-approvals-cache');

		await initPendingApprovalsCache(db.index);

		const approvals = getPendingApprovals();
		expect(approvals).toHaveLength(1);
		expect(approvals[0]!.sessionId).toBe(blockedSessionId);
		expect(approvals[0]!.toolName).toBe('ExitPlanMode');
		expect(approvals[0]!.projectId).toBe(PROJECT_ID);
		expect(approvals[0]!.projectName).toBe(PROJECT_NAME);
		expect(approvals[0]!.planFilename).toBe('alpha.md');
	});

	it('updatePendingApprovalForSession broadcasts APPROVAL_CHANGED on add and APPROVAL_RESOLVED on resolution', async () => {
		seedProject();

		const sessionId = 'sess-incremental';
		const filePath = writeJsonl(
			`${sessionId}.jsonl`,
			jsonl({
				type: 'assistant',
				sessionId,
				timestamp: '2026-05-14T13:00:00.000Z',
				message: {
					role: 'assistant',
					content: [
						{
							type: 'tool_use',
							id: 'toolu_inc',
							name: 'ExitPlanMode',
							input: {plan: '## Plan', planFilePath: '/Users/craig/.claude/plans/beta.md'},
						},
					],
				},
			}),
		);
		seedSession(sessionId, filePath);

		const {initPendingApprovalsCache, updatePendingApprovalForSession, getPendingApprovals} = await import(
			'../src/lib/db/pending-approvals-cache'
		);

		await initPendingApprovalsCache(db.index);
		// Init may or may not broadcast; reset so we test only the incremental updates.
		broadcastSpy.mockReset();

		// First update with no prior cached entry (cache was warmed by init) — treat as
		// a content-stable update. Simulate a fresh JSONL: a new pending tool_use that
		// was not previously cached. Use a different session to test the add path.
		const newSessionId = 'sess-new';
		const newPath = writeJsonl(
			`${newSessionId}.jsonl`,
			jsonl({
				type: 'assistant',
				sessionId: newSessionId,
				timestamp: '2026-05-14T14:00:00.000Z',
				message: {
					role: 'assistant',
					content: [
						{
							type: 'tool_use',
							id: 'toolu_new',
							name: 'AskUserQuestion',
							input: {question: 'Continue?'},
						},
					],
				},
			}),
		);
		seedSession(newSessionId, newPath);

		await updatePendingApprovalForSession(db.index, newSessionId, newPath, PROJECT_ID);

		const changedCalls = broadcastSpy.mock.calls.filter((c) => c[0] === DOMAIN_EVENTS.APPROVAL_CHANGED);
		expect(changedCalls).toHaveLength(1);
		const changedPayload = changedCalls[0]![1] as {approval: {sessionId: string; toolName: string}};
		expect(changedPayload.approval.sessionId).toBe(newSessionId);
		expect(changedPayload.approval.toolName).toBe('AskUserQuestion');

		// Now resolve the AskUserQuestion by appending a tool_result and updating again.
		writeFileSync(
			newPath,
			jsonl(
				{
					type: 'assistant',
					sessionId: newSessionId,
					timestamp: '2026-05-14T14:00:00.000Z',
					message: {
						role: 'assistant',
						content: [
							{
								type: 'tool_use',
								id: 'toolu_new',
								name: 'AskUserQuestion',
								input: {question: 'Continue?'},
							},
						],
					},
				},
				{
					type: 'user',
					sessionId: newSessionId,
					timestamp: '2026-05-14T14:01:00.000Z',
					message: {
						role: 'user',
						content: [{type: 'tool_result', tool_use_id: 'toolu_new', content: 'yes'}],
					},
				},
			),
		);

		broadcastSpy.mockReset();
		await updatePendingApprovalForSession(db.index, newSessionId, newPath, PROJECT_ID);

		const resolvedCalls = broadcastSpy.mock.calls.filter((c) => c[0] === DOMAIN_EVENTS.APPROVAL_RESOLVED);
		expect(resolvedCalls).toHaveLength(1);
		const resolvedPayload = resolvedCalls[0]![1] as {sessionId: string};
		expect(resolvedPayload.sessionId).toBe(newSessionId);

		const finalApprovals = getPendingApprovals();
		expect(finalApprovals.find((a) => a.sessionId === newSessionId)).toBeUndefined();
	});

	it('removePendingApprovalForSession clears the entry and broadcasts APPROVAL_RESOLVED when one was present', async () => {
		seedProject();

		const sessionId = 'sess-to-remove';
		const filePath = writeJsonl(
			`${sessionId}.jsonl`,
			jsonl({
				type: 'assistant',
				sessionId,
				timestamp: '2026-05-14T15:00:00.000Z',
				message: {
					role: 'assistant',
					content: [
						{
							type: 'tool_use',
							id: 'toolu_rm',
							name: 'ExitPlanMode',
							input: {plan: '## P'},
						},
					],
				},
			}),
		);
		seedSession(sessionId, filePath);

		const {initPendingApprovalsCache, removePendingApprovalForSession, getPendingApprovals} = await import(
			'../src/lib/db/pending-approvals-cache'
		);

		await initPendingApprovalsCache(db.index);
		broadcastSpy.mockReset();

		expect(getPendingApprovals().some((a) => a.sessionId === sessionId)).toBe(true);

		removePendingApprovalForSession(sessionId);

		const resolvedCalls = broadcastSpy.mock.calls.filter((c) => c[0] === DOMAIN_EVENTS.APPROVAL_RESOLVED);
		expect(resolvedCalls).toHaveLength(1);
		const payload = resolvedCalls[0]![1] as {sessionId: string};
		expect(payload.sessionId).toBe(sessionId);

		expect(getPendingApprovals().some((a) => a.sessionId === sessionId)).toBe(false);

		// Removing again with no prior entry must not broadcast.
		broadcastSpy.mockReset();
		removePendingApprovalForSession(sessionId);
		expect(broadcastSpy.mock.calls.filter((c) => c[0] === DOMAIN_EVENTS.APPROVAL_RESOLVED)).toHaveLength(0);
	});
});
