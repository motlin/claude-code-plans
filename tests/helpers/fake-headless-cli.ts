import {z} from "zod";

import {HeadlessSession, type HeadlessExit, type HeadlessProcess} from "../../src/lib/headless/session";

const FrameSchema = z.looseObject(
	{
		type: z.string(),
		request_id: z.string().optional(),
	},
);

/** A fake `claude -p --input-format stream-json` child: records stdin lines, emits stdout lines and exits on demand. */
export class FakeCli implements HeadlessProcess
{
	readonly pid = 4242;
	readonly stdin: unknown[] = [];
	ended = false;
	/** Answer every control_request the host writes with success, as a CLI that accepts it would. */
	autoAcknowledge = false;
	killed = false;
	private readonly lineListeners: ((line: string) => void)[] = [];
	private readonly exitListeners: ((exit: HeadlessExit) => void)[] = [];

	write(line: string): void
	{
		const frame = FrameSchema.parse(JSON.parse(line));
		this.stdin.push(frame);
		if (this.autoAcknowledge && frame.type === "control_request")
			this.emit(
				{
					type: "control_response",
					response:
					{
						subtype: "success",
						request_id: frame.request_id,
						response: {},
					},
				},
			);
	}

	end(): void
	{
		this.ended = true;
	}

	kill(): void
	{
		this.killed = true;
	}

	onLine(listener: (line: string) => void): void
	{
		this.lineListeners.push(listener);
	}

	onExit(listener: (exit: HeadlessExit) => void): void
	{
		this.exitListeners.push(listener);
	}

	emit(frame: object): void
	{
		for (const listener of this.lineListeners) listener(JSON.stringify(frame));
	}

	exit(exit: HeadlessExit): void
	{
		for (const listener of this.exitListeners) listener(exit);
	}
}

export function makeSession(cli = new FakeCli()):
{
	cli: FakeCli;
	session: HeadlessSession;
}
{
	let next = 0;
	const session = new HeadlessSession(
		{
			sessionId: "11111111-2222-4333-8444-555555555555",
			cwd: "/fixture/alice-project",
			process: cli,
			createRequestId: () => `req-${++next}`,
			setTimer: () => 0,
			clearTimer: () => undefined,
		},
	);
	return {
		cli,
		session,
	};
}
