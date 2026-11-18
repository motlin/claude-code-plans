import
{
	controlRequest,
	controlSuccess,
	initializeRequest,
	parseHeadlessLine,
	userMessage,
	type CanUseToolRequest,
	type DialogResult,
	type HeadlessFrame,
	type PermissionResult,
	type UserDialogRequest,
} from "./protocol";

/** The CLI child a headless session owns: line-framed stdin/stdout plus its exit. */
export interface HeadlessProcess
{
	readonly pid: number | undefined;
	/** Write one line (a newline is appended). */
	write: (line: string) => void;
	/** Close stdin: the CLI finishes its turn and exits. */
	end: () => void;
	kill: () => void;
	onLine: (listener: (line: string) => void) => void;
	onExit: (listener: (exit: HeadlessExit) => void) => void;
}

export interface HeadlessExit
{
	code: number | null;
	signal: string | null;
	/** Set when the process could not be spawned or failed outside a normal exit. */
	error: string | null;
}

/** `working` mid-turn, `blocked` on a permission or dialog, `idle` between turns, `ended` once the CLI exits. */
export type HeadlessStatus = "starting" | "working" | "blocked" | "idle" | "ended";

export interface HeadlessTask
{
	taskId: string;
	description: string;
	toolUseId: string | null;
}

export class HeadlessRequestError extends Error
{
	constructor(message: string)
	{
		super(message);
		this.name = "HeadlessRequestError";
	}
}

/** How long a control request may go unanswered before its caller gets an error. */
const CONTROL_RESPONSE_TIMEOUT_MS = 10_000;

export interface HeadlessSessionOptions
{
	sessionId: string;
	cwd: string;
	process: HeadlessProcess;
	createRequestId: () => string;
	/** Called after every state change (status, tasks, pending requests, exit). */
	onChange?: (session: HeadlessSession) => void;
	setTimer?: (callback: () => void, ms: number) => unknown;
	clearTimer?: (timer: unknown) => void;
}

interface Waiter
{
	resolve: (response: Record<string, unknown>) => void;
	reject: (error: Error) => void;
	timer: unknown;
}

/**
 * One app-owned `claude -p --input-format stream-json` process, kept alive
 * across turns. It tracks what the UI's controls need: the turn status, the
 * running background tasks, and the CLI's open `can_use_tool` and
 * `request_user_dialog` requests, and answers them over the control protocol.
 */
export class HeadlessSession
{
	readonly sessionId: string;
	readonly cwd: string;
	private statusValue: HeadlessStatus = "starting";
	private lastPromptValue: string | null = null;
	private readonly tasks = new Map<string, HeadlessTask>();
	private readonly permissions = new Map<string, CanUseToolRequest>();
	private readonly dialogs = new Map<string, UserDialogRequest>();
	private readonly waiters = new Map<string, Waiter>();
	private readonly process: HeadlessProcess;
	private readonly createRequestId: () => string;
	private readonly onChange: (session: HeadlessSession) => void;
	private readonly setTimer: (callback: () => void, ms: number) => unknown;
	private readonly clearTimer: (timer: unknown) => void;

	constructor(options: HeadlessSessionOptions)
	{
		this.sessionId = options.sessionId;
		this.cwd = options.cwd;
		this.process = options.process;
		this.createRequestId = options.createRequestId;
		this.onChange = options.onChange ?? (() => undefined);
		this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
		this.clearTimer =
			options.clearTimer ??
			((timer) =>
			{
				// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the default timer is setTimeout's
				clearTimeout(timer as ReturnType<typeof setTimeout>);
			});
		this.process.onLine((line) =>
		{
			this.handleLine(line);
		});
		this.process.onExit(() =>
		{
			this.handleExit();
		});
	}

	get status(): HeadlessStatus
	{
		return this.statusValue;
	}

	/** The newest prompt sent, which a refusal's Edit hands back to the composer. */
	get lastPrompt(): string | null
	{
		return this.lastPromptValue;
	}

	get pid(): number | undefined
	{
		return this.process.pid;
	}

	runningTasks(): HeadlessTask[]
	{
		return [...this.tasks.values()];
	}

	/** Open tool permission requests, oldest first (AskUserQuestion included). */
	pendingToolRequests(): CanUseToolRequest[]
	{
		return [...this.permissions.values()];
	}

	pendingDialogs(): UserDialogRequest[]
	{
		return [...this.dialogs.values()];
	}

	/** Declare the dialogs this app renders, then send the first prompt when there is one. */
	start(prompt: string | undefined): void
	{
		this.write(initializeRequest(this.createRequestId()));
		if (prompt !== undefined) this.sendPrompt(prompt);
	}

	/** Queue a user message; the CLI takes it at once when idle, else after the running turn. */
	sendPrompt(prompt: string): void
	{
		this.assertAlive();
		this.write(userMessage(prompt));
		this.lastPromptValue = prompt;
		if (this.statusValue !== "blocked") this.setStatus("working");
	}

	async interrupt(): Promise<void>
	{
		await this.request(
			{
				subtype: "interrupt",
			},
		);
	}

	async stopTask(taskId: string): Promise<void>
	{
		await this.request(
			{
				subtype: "stop_task",
				task_id: taskId,
			},
		);
	}

	/** Stop every running task: there is no kill-all request, so one `stop_task` each. Returns the ids stopped. */
	async stopAllTasks(): Promise<string[]>
	{
		const ids = [...this.tasks.keys()];
		await Promise.all(ids.map(async (taskId) => this.stopTask(taskId)));
		return ids;
	}

	async setPermissionMode(mode: string): Promise<void>
	{
		await this.request(
			{
				subtype: "set_permission_mode",
				mode,
			},
		);
	}

	answerToolRequest(requestId: string, result: PermissionResult): void
	{
		this.assertAlive();
		if (!this.permissions.delete(requestId))
			throw new HeadlessRequestError("No such permission request is pending");
		this.write(
			controlSuccess(
				requestId,
				{
					...result,
				},
			),
		);
		this.settleBlocked();
	}

	answerDialog(requestId: string, result: DialogResult): void
	{
		this.assertAlive();
		if (!this.dialogs.delete(requestId)) throw new HeadlessRequestError("No such dialog is pending");
		this.write(
			controlSuccess(
				requestId,
				{
					...result,
				},
			),
		);
		this.settleBlocked();
	}

	/** Close stdin so the CLI exits on its own; the exit handler marks the session ended. */
	close(): void
	{
		if (this.statusValue === "ended") return;
		this.process.end();
	}

	private async request(request: Record<string, unknown>): Promise<Record<string, unknown>>
	{
		this.assertAlive();
		const requestId = this.createRequestId();
		const response = new Promise<Record<string, unknown>>((resolve, reject) =>
		{
			const timer = this.setTimer(() =>
			{
				this.waiters.delete(requestId);
				reject(new HeadlessRequestError(`The CLI did not answer ${String(request["subtype"])}`));
			}, CONTROL_RESPONSE_TIMEOUT_MS);
			this.waiters.set(
				requestId,
				{
					resolve,
					reject,
					timer,
				},
			);
		});
		this.write(controlRequest(requestId, request));
		return response;
	}

	private write(frame: HeadlessFrame): void
	{
		this.process.write(JSON.stringify(frame));
	}

	private assertAlive(): void
	{
		if (this.statusValue === "ended") throw new HeadlessRequestError("The headless session has ended");
	}

	private setStatus(status: HeadlessStatus): void
	{
		if (this.statusValue === "ended") return;
		this.statusValue = status;
		this.onChange(this);
	}

	private settleBlocked(): void
	{
		if (this.permissions.size > 0 || this.dialogs.size > 0) this.setStatus("blocked");
		else this.setStatus("working");
	}

	private handleLine(line: string): void
	{
		const event = parseHeadlessLine(line);
		switch (event.type)
		{
			case "can_use_tool":
			{
				const {type: _type, ...request} = event;
				this.permissions.set(event.requestId, request);
				this.setStatus("blocked");
				return;
			}
			case "dialog":
			{
				const {type: _type, ...request} = event;
				this.dialogs.set(event.requestId, request);
				this.setStatus("blocked");
				return;
			}
			case "unsupported_request":
				// Answer what we cannot serve so the CLI never waits on us.
				this.write(
					{
						type: "control_response",
						response:
						{
							subtype: "error",
							request_id: event.requestId,
							error: `${event.subtype} is not supported by this host`,
						},
					},
				);
				return;
			case "control_response":
			{
				const waiter = this.waiters.get(event.requestId);
				if (waiter === undefined) return;
				this.waiters.delete(event.requestId);
				this.clearTimer(waiter.timer);
				if (event.ok) waiter.resolve(event.response);
				else waiter.reject(new HeadlessRequestError(event.error ?? "The CLI refused the request"));
				return;
			}
			case "cancel":
				if (this.permissions.delete(event.requestId) || this.dialogs.delete(event.requestId))
				{
					if (this.statusValue === "blocked") this.settleBlocked();
				}
				return;
			case "task_started":
				this.tasks.set(
					event.taskId,
					{
						taskId: event.taskId,
						description: event.description,
						toolUseId: event.toolUseId,
					},
				);
				this.onChange(this);
				return;
			case "task_ended":
				if (this.tasks.delete(event.taskId)) this.onChange(this);
				return;
			case "result":
				if (this.permissions.size === 0 && this.dialogs.size === 0) this.setStatus("idle");
				return;
			case "ignored":
				return;
		}
	}

	private handleExit(): void
	{
		if (this.statusValue === "ended") return;
		this.statusValue = "ended";
		this.permissions.clear();
		this.dialogs.clear();
		this.tasks.clear();
		for (const waiter of this.waiters.values())
		{
			this.clearTimer(waiter.timer);
			waiter.reject(new HeadlessRequestError("The headless session has ended"));
		}
		this.waiters.clear();
		this.onChange(this);
	}
}
