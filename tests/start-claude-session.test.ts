import {describe, expect, it, vi} from "vite-plus/test";
import type {ToastOptions} from "../src/components/toast";
import {startClaudeSession, type StartClaudeSessionDependencies} from "../src/lib/start-claude-session";

function dependencies(overrides: Partial<StartClaudeSessionDependencies> = {}) {
	const toasts: ToastOptions[] = [];
	const deps: StartClaudeSessionDependencies = {
		launch: vi.fn(async () => ({sessionId: "session-test-100"})),
		copy: vi.fn(async () => true),
		toast: (options) => toasts.push(options),
		...overrides,
	};
	return {deps, toasts};
}

describe("startClaudeSession", () => {
	it("launches claude with the prompt in a new herdr tab", async () => {
		const {deps, toasts} = dependencies();

		const outcome = await startClaudeSession("/skill-creator", deps);

		expect({
			outcome,
			launches: vi.mocked(deps.launch).mock.calls,
			copies: vi.mocked(deps.copy).mock.calls,
			toasts,
		}).toStrictEqual({
			outcome: "launched",
			launches: [[{prompt: "/skill-creator"}]],
			copies: [],
			toasts: [{kind: "success", message: "Started a session in a new herdr tab"}],
		});
	});

	it("copies the command when herdr cannot launch it", async () => {
		const {deps, toasts} = dependencies({
			launch: vi.fn(async () => {
				throw new Error("herdr writes are disabled");
			}),
		});

		const outcome = await startClaudeSession("Create a new skill", deps);

		expect({outcome, copies: vi.mocked(deps.copy).mock.calls, toasts}).toStrictEqual({
			outcome: "copied",
			copies: [["claude 'Create a new skill'"]],
			toasts: [{kind: "success", message: "Copied command — herdr unavailable"}],
		});
	});

	it("reports a failure when neither launch nor copy works", async () => {
		const {deps, toasts} = dependencies({
			launch: vi.fn(async () => {
				throw new Error("down");
			}),
			copy: vi.fn(async () => false),
		});

		const outcome = await startClaudeSession("/skill-creator", deps);

		expect({outcome, toasts}).toStrictEqual({
			outcome: "failed",
			toasts: [{kind: "error", message: "Couldn’t start a session. Try again."}],
		});
	});
});
