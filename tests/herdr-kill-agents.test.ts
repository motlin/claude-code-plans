import {describe, expect, it} from "vite-plus/test";

import {handleHerdrKillAgents, type HerdrKillAgentsDependencies} from "../src/lib/herdr/kill-agents";
import {rejectCrossSite} from "../src/lib/same-origin-guard";
import {BASH_FULL} from "./fixtures/permission-screens";
import {promptBox} from "./fixtures/refusal-fallback-screens";

/** The idle prompt box with the CLI's `kill-agents-confirm` notification under it (CLI 2.1.326). */
const CONFIRM = `${promptBox("")}\n  Press ctrl+x ctrl+k again to stop background agents`;
/** The footer's short form of the same notification (`row1Hint`). */
const CONFIRM_ROW_HINT = `${promptBox("")}\n  ctrl+x ctrl+k again to stop agents`;
/** The CLI's `kill-agents-none` notification: nothing it could stop. */
const NONE = `${promptBox("")}\n  No background agents running`;

function postRequest(body: unknown, headers?: HeadersInit): Request
{
	const requestHeaders = new Headers(headers);
	requestHeaders.set("Content-Type", "application/json");
	return new Request(
		"http://127.0.0.1:7526/api/herdr/kill-agents",
		{
			method: "POST",
			headers: requestHeaders,
			body: JSON.stringify(body),
		},
	);
}

/** Fake dependencies that log every key, pause and read in order, serving `screens` one read at a time. */
function harness(screens: string[], overrides: Partial<HerdrKillAgentsDependencies> = {})
{
	const log: string[] = [];
	const remaining = [...screens];
	const dependencies: HerdrKillAgentsDependencies =
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
					target: string;
					keys: string[];
				};
			};
			log.push(`${fields.method} ${fields.params.target} ${fields.params.keys.join(" ")}`);
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
		createRequestId: () => "ccp:kill-agents:test",
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

async function post(
	screens: string[],
	overrides: Partial<HerdrKillAgentsDependencies> = {},
	body: unknown =
	{
		sessionId: "session-1",
	},
	headers?: HeadersInit,
)
{
	const {log, dependencies} = harness(screens, overrides);
	const response = await handleHerdrKillAgents(postRequest(body, headers), dependencies);
	return {
		status: response.status,
		body: await response.json(),
		log,
	};
}

describe("herdr kill-agents handler", () =>
{
	it("presses the chord, waits for the CLI's confirm notification, then presses it again", async () =>
	{
		expect(await post([promptBox(""), promptBox(""), CONFIRM])).toStrictEqual(
			{
				status: 200,
				body:
				{
					ok: true,
				},
				log: [
					"pane.read session-1 w1:p1",
					"agent.send_keys w1:p1 ctrl+x ctrl+k",
					"pause",
					"pane.read session-1 w1:p1",
					"pause",
					"pane.read session-1 w1:p1",
					"agent.send_keys w1:p1 ctrl+x ctrl+k",
				],
			},
		);
	});

	it("reads the footer's short confirm hint too, and works with text in the CLI input", async () =>
	{
		expect(await post([promptBox("half typed"), CONFIRM_ROW_HINT])).toStrictEqual(
			{
				status: 200,
				body:
				{
					ok: true,
				},
				log: [
					"pane.read session-1 w1:p1",
					"agent.send_keys w1:p1 ctrl+x ctrl+k",
					"pause",
					"pane.read session-1 w1:p1",
					"agent.send_keys w1:p1 ctrl+x ctrl+k",
				],
			},
		);
	});

	it("presses once when the confirm notification is already up", async () =>
	{
		expect(await post([CONFIRM])).toStrictEqual(
			{
				status: 200,
				body:
				{
					ok: true,
				},
				log: ["pane.read session-1 w1:p1", "agent.send_keys w1:p1 ctrl+x ctrl+k"],
			},
		);
	});

	it("refuses with 409 and presses nothing when a permission dialog is up", async () =>
	{
		expect(await post([BASH_FULL])).toStrictEqual(
			{
				status: 409,
				body:
				{
					error: "The terminal is not showing its prompt",
				},
				log: ["pane.read session-1 w1:p1"],
			},
		);
	});

	it("stops after one press when the CLI says nothing is running", async () =>
	{
		expect(await post([promptBox(""), NONE])).toStrictEqual(
			{
				status: 409,
				body:
				{
					error: "No background agents are running",
				},
				log: [
					"pane.read session-1 w1:p1",
					"agent.send_keys w1:p1 ctrl+x ctrl+k",
					"pause",
					"pane.read session-1 w1:p1",
				],
			},
		);
	});

	it("gives up without a second press when the confirm notification never shows", async () =>
	{
		const {status, body, log} = await post([promptBox("")]);
		expect(
			{
				status,
				body,
				keys: log.filter((line) => line.startsWith("agent.send_keys")),
				reads: log.filter((line) => line.startsWith("pane.read")).length,
			},
		).toStrictEqual(
			{
				status: 409,
				body:
				{
					error: "The terminal did not ask to confirm stopping background agents",
				},
				keys: ["agent.send_keys w1:p1 ctrl+x ctrl+k"],
				reads: 13,
			},
		);
	});

	it("maps herdr's agent_not_ready to 409", async () =>
	{
		expect(
			await post(
				[promptBox("")],
				{
					request: async () =>
						Promise.resolve(
							{
								ok: false,
								code: "agent_not_ready",
								message: "agent is not ready",
							},
						),
				},
			),
		).toStrictEqual(
			{
				status: 409,
				body:
				{
					error: "agent is not ready",
				},
				log: ["pane.read session-1 w1:p1"],
			},
		);
	});

	it("refuses with 403 while writes are off, 400 for a bad body, and rejects a cross-site request", async () =>
	{
		expect(
			{
				writesOff: await post(
					[promptBox("")],
					{
						writesEnabled: () => false,
					},
				),
				badBody: await post(
					[promptBox("")],
					{},
					{
						sessionId: "",
					},
				),
				crossSite: (
					await post(
						[promptBox("")],
						{},
						{
							sessionId: "session-1",
						},
						{
							Origin: "https://evil.example",
						},
					)
				).log,
			},
		).toStrictEqual(
			{
				writesOff:
				{
					status: 403,
					body:
					{
						error: "herdr writes are disabled",
					},
					log: [],
				},
				badBody:
				{
					status: 400,
					body:
					{
						error: "sessionId is required",
					},
					log: [],
				},
				crossSite: [],
			},
		);
	});
});
