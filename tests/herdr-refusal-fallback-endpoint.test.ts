import {describe, expect, it} from "vite-plus/test";

import
{
	handleHerdrRefusalFallback,
	handleHerdrRefusalFallbackDialog,
	type HerdrRefusalFallbackDependencies,
} from "../src/lib/herdr/refusal-fallback";
import {rejectCrossSite} from "../src/lib/same-origin-guard";
import {promptBox, REFUSAL_DIALOG} from "./fixtures/refusal-fallback-screens";

const URL = "http://127.0.0.1:7526/api/herdr/refusal-fallback";

function postRequest(body: unknown, headers?: HeadersInit): Request
{
	const requestHeaders = new Headers(headers);
	requestHeaders.set("Content-Type", "application/json");
	return new Request(
		URL,
		{
			method: "POST",
			headers: requestHeaders,
			body: JSON.stringify(body),
		},
	);
}

async function describeResponse(response: Response): Promise<
{
	body: unknown;
	status: number;
}>
{
	return {
		body: await response.json(),
		status: response.status,
	};
}

/** Fake dependencies that log every key, pause and read in order, serving `screens` one read at a time. */
function harness(screens: string[], overrides: Partial<HerdrRefusalFallbackDependencies> = {})
{
	const log: string[] = [];
	const remaining = [...screens];
	const dependencies: HerdrRefusalFallbackDependencies =
	{
		rejectRequest: rejectCrossSite,
		writesEnabled: () => true,
		resolveTarget: async () =>
			Promise.resolve(
				{
					ok: true,
					value:
					{
						terminalId: "terminal-1",
						paneId: "w1:p1",
					},
				},
			),
		readScreen: async (sessionId, paneId) =>
		{
			log.push(`pane.read ${sessionId} ${paneId}`);
			const screen = remaining.length > 1 ? remaining.shift() : remaining[0];
			return Promise.resolve(
				screen === undefined
					?
						{
							ok: false,
							code: "no-screen",
							message: "no screen left",
						}
					:
						{
							ok: true,
							value: screen,
						},
			);
		},
		request: async (call) =>
		{
			const fields = call as
			{
				method: string;
				params:
				{
					keys?: string[];
				};
			};
			log.push(`${fields.method} ${fields.params.keys?.join(" ") ?? ""}`);
			return Promise.resolve(
				{
					ok: true,
					value:
					{
						type: "ok",
					},
				},
			);
		},
		createRequestId: () => "ccp:refusal-fallback:test",
		pause: async () =>
		{
			log.push("pause");
			return Promise.resolve();
		},
		...overrides,
	};
	return {
		log,
		dependencies,
	};
}

async function choose(choice: unknown, screens: string[], overrides: Partial<HerdrRefusalFallbackDependencies> = {})
{
	const {log, dependencies} = harness(screens, overrides);
	const response = await handleHerdrRefusalFallback(
		postRequest(
			{
				sessionId: "session-1",
				choice,
			},
		),
		dependencies,
	);
	return {
		response: await describeResponse(response),
		log,
	};
}

describe("herdr refusal fallback handler", () =>
{
	it("retry_fallback presses the Switch row's digit once", async () =>
	{
		expect(await choose("retry_fallback", [REFUSAL_DIALOG])).toStrictEqual(
			{
				response:
				{
					body:
					{
						ok: true,
					},
					status: 200,
				},
				log: ["pane.read session-1 w1:p1", "agent.send_keys 1"],
			},
		);
	});

	it("edit_prompt presses the Edit row, waits for the prompt in the CLI input, then clears it into the response", async () =>
	{
		expect(
			await choose("edit_prompt", [
				REFUSAL_DIALOG,
				REFUSAL_DIALOG,
				promptBox("my prompt"),
				promptBox("my prompt"),
				promptBox(""),
			]),
		).toStrictEqual(
			{
				response:
				{
					body:
					{
						ok: true,
						text: "my prompt",
					},
					status: 200,
				},
				log: [
					"pane.read session-1 w1:p1",
					"agent.send_keys 2",
					"pause",
					"pane.read session-1 w1:p1",
					"pause",
					"pane.read session-1 w1:p1",
					"pane.read session-1 w1:p1",
					"agent.send_keys ctrl+u",
					"pause",
					"pane.read session-1 w1:p1",
				],
			},
		);
	});

	it("edit_prompt answers a null text when the CLI input never fills", async () =>
	{
		const {response, log} = await choose("edit_prompt", [REFUSAL_DIALOG, promptBox("")]);
		expect(
			{
				response,
				keys: log.filter((line) => line.startsWith("agent.send_keys")),
			},
		).toStrictEqual(
			{
				response:
				{
					body:
					{
						ok: true,
						text: null,
					},
					status: 200,
				},
				keys: ["agent.send_keys 2"],
			},
		);
	});

	it("cancelled presses Esc", async () =>
	{
		expect(await choose("cancelled", [REFUSAL_DIALOG])).toStrictEqual(
			{
				response:
				{
					body:
					{
						ok: true,
					},
					status: 200,
				},
				log: ["pane.read session-1 w1:p1", "agent.send_keys esc"],
			},
		);
	});

	it("refuses with 409 and presses nothing when the screen does not show the dialog", async () =>
	{
		expect(await choose("retry_fallback", [promptBox("")])).toStrictEqual(
			{
				response:
				{
					body:
					{
						error: "The terminal is not showing this dialog",
					},
					status: 409,
				},
				log: ["pane.read session-1 w1:p1"],
			},
		);
	});

	it("refuses with 403 while writes are off", async () =>
	{
		expect(
			await choose(
				"retry_fallback",
				[REFUSAL_DIALOG],
				{
					writesEnabled: () => false,
				},
			),
		).toStrictEqual(
			{
				response:
				{
					body:
					{
						error: "herdr writes are disabled",
					},
					status: 403,
				},
				log: [],
			},
		);
	});

	it("refuses a bad body with 400", async () =>
	{
		expect(await choose("retry", [REFUSAL_DIALOG])).toStrictEqual(
			{
				response:
				{
					body:
					{
						error: "sessionId and a refusal fallback choice are required",
					},
					status: 400,
				},
				log: [],
			},
		);
	});

	it("rejects a cross-site request", async () =>
	{
		const {log, dependencies} = harness([REFUSAL_DIALOG]);
		const response = await handleHerdrRefusalFallback(
			postRequest(
				{
					sessionId: "session-1",
					choice: "retry_fallback",
				},
				{
					Origin: "https://evil.example",
				},
			),
			dependencies,
		);
		expect(
			{
				status: response.status,
				log,
			},
		).toStrictEqual(
			{
				status: 403,
				log: [],
			},
		);
	});

	it("GET reads the dialog off the pane, or null when it is not shown", async () =>
	{
		const read = async (screen: string) =>
			describeResponse(
				await handleHerdrRefusalFallbackDialog(
					new Request(`${URL}?sessionId=session-1`),
					harness([screen]).dependencies,
				),
			);
		expect(
			{
				shown: await read(REFUSAL_DIALOG),
				gone: await read(promptBox("")),
			},
		).toStrictEqual(
			{
				shown:
				{
					body:
					{
						dialog:
						{
							body: "Opus 4.7's safeguards flagged this message. This sometimes happens with safe, normal conversations.",
							guidance: null,
							category: "cyber",
							switchLabel: "Switch to Sonnet 4.6",
							switchRow: 1,
							editLabel: "Edit prompt and retry with Opus 4.7",
							editRow: 2,
							focus: "switch",
						},
					},
					status: 200,
				},
				gone:
				{
					body:
					{
						dialog: null,
					},
					status: 200,
				},
			},
		);
	});
});
