import {describe, expect, it} from "vite-plus/test";

import {makeSession} from "./helpers/fake-headless-cli";

describe("HeadlessSession protocol", () =>
{
	it("declares the refusal-fallback dialog in initialize and sends the first prompt as a user message", () =>
	{
		const {cli, session} = makeSession();

		session.start("Say pong");

		expect(cli.stdin).toStrictEqual([
			{
				type: "control_request",
				request_id: "req-1",
				request:
				{
					subtype: "initialize",
					supportedDialogKinds: ["refusal_fallback_prompt"],
				},
			},
			{
				type: "user",
				message:
				{
					role: "user",
					content: "Say pong",
				},
				parent_tool_use_id: null,
				session_id: "",
			},
		]);
		expect(session.status).toBe("working");
	});

	it("goes idle on a result frame", () =>
	{
		const {cli, session} = makeSession();
		session.start("Say pong");

		cli.emit(
			{
				type: "result",
				subtype: "success",
			},
		);

		expect(session.status).toBe("idle");
	});

	it("interrupts with an interrupt control_request and resolves on its success response", async () =>
	{
		const {cli, session} = makeSession();
		cli.autoAcknowledge = true;
		await session.interrupt();

		expect(cli.stdin).toStrictEqual([
			{
				type: "control_request",
				request_id: "req-1",
				request:
				{
					subtype: "interrupt",
				},
			},
		]);
	});

	it("rejects a control request the CLI answers with an error", async () =>
	{
		const {cli, session} = makeSession();
		const stopped = session.stopTask("b1234abcd");
		cli.emit(
			{
				type: "control_response",
				response:
				{
					subtype: "error",
					request_id: "req-1",
					error: "No task b1234abcd",
				},
			},
		);

		await expect(stopped).rejects.toThrow("No task b1234abcd");
	});

	it("tracks running tasks from task_started until task_notification or a terminal task_updated", () =>
	{
		const {cli, session} = makeSession();
		cli.emit(
			{
				type: "system",
				subtype: "task_started",
				task_id: "b0000aaaa",
				description: "npm run watch",
				tool_use_id: "toolu_alice",
			},
		);
		cli.emit(
			{
				type: "system",
				subtype: "task_started",
				task_id: "a0000bbbb",
				description: "Research Bob's question",
			},
		);
		cli.emit(
			{
				type: "system",
				subtype: "task_started",
				task_id: "a0000cccc",
				description: "Summarize Carol's notes",
			},
		);
		cli.emit(
			{
				type: "system",
				subtype: "task_notification",
				task_id: "a0000bbbb",
				status: "completed",
				output_file: "",
				summary: "",
			},
		);
		cli.emit(
			{
				type: "system",
				subtype: "task_updated",
				task_id: "a0000cccc",
				patch:
				{
					status: "killed",
				},
			},
		);

		expect(session.runningTasks()).toStrictEqual([
			{
				taskId: "b0000aaaa",
				description: "npm run watch",
				toolUseId: "toolu_alice",
			},
		]);
	});

	it("stops all agents with one stop_task per running task", async () =>
	{
		const {cli, session} = makeSession();
		for (const taskId of ["b0000aaaa", "a0000bbbb"])
			cli.emit(
				{
					type: "system",
					subtype: "task_started",
					task_id: taskId,
					description: `task ${taskId}`,
				},
			);

		const stopped = session.stopAllTasks();
		for (const requestId of ["req-1", "req-2"])
			cli.emit(
				{
					type: "control_response",
					response:
					{
						subtype: "success",
						request_id: requestId,
						response: {},
					},
				},
			);

		expect(await stopped).toStrictEqual(["b0000aaaa", "a0000bbbb"]);
		expect(cli.stdin).toStrictEqual([
			{
				type: "control_request",
				request_id: "req-1",
				request:
				{
					subtype: "stop_task",
					task_id: "b0000aaaa",
				},
			},
			{
				type: "control_request",
				request_id: "req-2",
				request:
				{
					subtype: "stop_task",
					task_id: "a0000bbbb",
				},
			},
		]);
	});

	it("blocks on can_use_tool and answers it with a control_response", () =>
	{
		const {cli, session} = makeSession();
		session.start("List files");
		cli.stdin.length = 0;
		cli.emit(
			{
				type: "control_request",
				request_id: "cli-perm-1",
				request:
				{
					subtype: "can_use_tool",
					tool_name: "Bash",
					input:
					{
						command: "ls",
					},
					tool_use_id: "toolu_bash",
				},
			},
		);

		expect(session.status).toBe("blocked");
		expect(session.pendingToolRequests()).toStrictEqual([
			{
				requestId: "cli-perm-1",
				toolName: "Bash",
				input:
				{
					command: "ls",
				},
				suggestions: null,
				toolUseId: "toolu_bash",
			},
		]);

		session.answerToolRequest(
			"cli-perm-1",
			{
				behavior: "allow",
				updatedInput:
				{
					command: "ls",
				},
			},
		);

		expect(cli.stdin).toStrictEqual([
			{
				type: "control_response",
				response:
				{
					subtype: "success",
					request_id: "cli-perm-1",
					response:
					{
						behavior: "allow",
						updatedInput:
						{
							command: "ls",
						},
					},
				},
			},
		]);
		expect(session.status).toBe("working");
		expect(session.pendingToolRequests()).toStrictEqual([]);
	});

	it("drops a pending request the CLI withdraws with control_cancel_request", () =>
	{
		const {cli, session} = makeSession();
		cli.emit(
			{
				type: "control_request",
				request_id: "cli-dialog-1",
				request:
				{
					subtype: "request_user_dialog",
					dialog_kind: "refusal_fallback_prompt",
					payload:
					{
						originalModel: "claude-fable-5",
						fallbackModel: "claude-opus-4-8",
					},
				},
			},
		);
		expect(session.status).toBe("blocked");

		cli.emit(
			{
				type: "control_cancel_request",
				request_id: "cli-dialog-1",
			},
		);

		expect(session.pendingDialogs()).toStrictEqual([]);
		expect(session.status).toBe("working");
	});

	it("answers a CLI request it cannot serve with an error response", () =>
	{
		const {cli} = makeSession();
		cli.emit(
			{
				type: "control_request",
				request_id: "cli-hook-1",
				request:
				{
					subtype: "hook_callback",
				},
			},
		);

		expect(cli.stdin).toStrictEqual([
			{
				type: "control_response",
				response:
				{
					subtype: "error",
					request_id: "cli-hook-1",
					error: "hook_callback is not supported by this host",
				},
			},
		]);
	});
});

describe("HeadlessSession lifecycle", () =>
{
	it("marks the session ended on exit, rejects open requests and refuses new writes", async () =>
	{
		const {cli, session} = makeSession();
		const interrupted = session.interrupt();

		cli.exit(
			{
				code: 1,
				signal: null,
				error: null,
			},
		);

		await expect(interrupted).rejects.toThrow("The headless session has ended");
		expect(session.status).toBe("ended");
		expect(() =>
		{
			session.sendPrompt("Hello again");
		}).toThrow("The headless session has ended");
	});

	it("marks a process that failed to spawn ended", () =>
	{
		const {cli, session} = makeSession();

		cli.exit(
			{
				code: null,
				signal: null,
				error: "spawn claude ENOENT",
			},
		);

		expect(session.status).toBe("ended");
	});

	it("closes stdin to end the session gracefully", () =>
	{
		const {cli, session} = makeSession();

		session.close();

		expect(cli.ended).toBe(true);
	});
});
