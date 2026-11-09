import {describe, expect, it, vi} from "vite-plus/test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {
	handleHerdrPermission,
	handleHerdrPermissionDialog,
	type HerdrPermissionDependencies,
} from "../src/lib/herdr/permission";
import type {HerdrRequester} from "../src/lib/herdr/panes";
import {rejectCrossSite} from "../src/lib/same-origin-guard";
import {
	BASH_ASK_RULE,
	BASH_FULL,
	BASH_FULL_NO_FEEDBACK_TYPED,
	BASH_UNICODE_WHITESPACE,
	CLASSIFIER_FALLBACK,
	READ_OUTSIDE_AUTO_FIRST_PROMPT,
	EDIT_ACCEPT_EDITS_ROW,
	READ_OUTSIDE_SESSION_DIR,
	WEBFETCH,
} from "./fixtures/permission-screens";

const PLAN_DIALOG = readFileSync(join(import.meta.dirname, "fixtures/plan-approval-dialog.txt"), "utf8");
/** The pane once the CLI has taken the answer: the dialog is gone. */
const ANSWERED = "$ ";

function request(body: unknown, headers?: HeadersInit): Request {
	const requestHeaders = new Headers(headers);
	requestHeaders.set("Content-Type", "application/json");
	return new Request("http://127.0.0.1:7526/api/herdr/permission", {
		method: "POST",
		headers: requestHeaders,
		body: JSON.stringify(body),
	});
}

async function describeResponse(response: Response): Promise<{body: unknown; status: number}> {
	return {body: await response.json(), status: response.status};
}

function dependencies(overrides: Partial<HerdrPermissionDependencies> = {}): HerdrPermissionDependencies {
	return {
		rejectRequest: rejectCrossSite,
		writesEnabled: () => true,
		hasPendingPermission: () => true,
		persistentAllow: () => null,
		dialogKind: async () => Promise.resolve("generic"),
		clearPendingPermission: () => {},
		resolveTarget: async () =>
			Promise.resolve({
				ok: true,
				value: {terminalId: "terminal-test-100", paneId: "w100:p100"},
			}),
		request: async () => Promise.resolve({ok: true, value: {type: "ok"}}),
		createRequestId: () => "ccp:permission:test-100",
		readScreen: async () => Promise.resolve({ok: false, code: "bad-response", message: "Fabricated read failure"}),
		pause: async () => Promise.resolve(),
		...overrides,
	};
}

describe("herdr permission decision handler", () => {
	it("returns before resolving when writes are disabled", async () => {
		const sendRequest = vi.fn<HerdrRequester>();
		const response = await handleHerdrPermission(
			request({sessionId: "session-test-100", decision: "allow"}),
			dependencies({writesEnabled: () => false, request: sendRequest}),
		);
		expect({
			response: await describeResponse(response),
			sendRequestCalls: sendRequest.mock.calls,
		}).toStrictEqual({
			response: {body: {error: "herdr writes are disabled"}, status: 403},
			sendRequestCalls: [],
		});
	});

	it("rejects cross-site requests", async () => {
		const response = await handleHerdrPermission(
			request(
				{sessionId: "session-test-100", decision: "allow"},
				{Origin: "https://attacker.example.com", "Sec-Fetch-Site": "cross-site"},
			),
			dependencies(),
		);
		expect(response.status).toStrictEqual(403);
	});

	it.each([
		{body: {sessionId: "session-test-100"}, name: "missing decision"},
		{body: {sessionId: "", decision: "allow"}, name: "empty session id"},
		{body: {sessionId: "session-test-100", decision: "forever"}, name: "unknown decision"},
		{
			body: {sessionId: "session-test-100", decision: "allow", keys: ["ctrl+c"]},
			name: "caller-supplied keys",
		},
	])("returns 400 for $name", async ({body}) => {
		const sendRequest = vi.fn<HerdrRequester>();
		const response = await handleHerdrPermission(request(body), dependencies({request: sendRequest}));
		expect({
			response: await describeResponse(response),
			sendRequestCalls: sendRequest.mock.calls,
		}).toStrictEqual({
			response: {
				body: {error: 'sessionId is required and decision must be "allow", "always", "deny", or "allowAuto"'},
				status: 400,
			},
			sendRequestCalls: [],
		});
	});

	it("refuses to type into a pane that is not at a permission prompt", async () => {
		const sendRequest = vi.fn<HerdrRequester>();
		const response = await handleHerdrPermission(
			request({sessionId: "session-test-100", decision: "allow"}),
			dependencies({hasPendingPermission: () => false, request: sendRequest}),
		);
		expect({
			response: await describeResponse(response),
			sendRequestCalls: sendRequest.mock.calls,
		}).toStrictEqual({
			response: {body: {error: "No permission request is pending", code: "not_pending"}, status: 409},
			sendRequestCalls: [],
		});
	});

	it.each([{persistent: null}, {persistent: "always"}, {persistent: "perChat"}] as const)(
		"refuses always without a readable screen, though the hook's persistent option is $persistent, as upstream forces suppressAlwaysAllowRule while the ask flags are unknown",
		async ({persistent}) => {
			const sendRequest = vi.fn<HerdrRequester>();
			const response = await handleHerdrPermission(
				request({sessionId: "session-test-100", decision: "always"}),
				dependencies({persistentAllow: () => persistent, request: sendRequest}),
			);
			expect({
				response: await describeResponse(response),
				sendRequestCalls: sendRequest.mock.calls,
			}).toStrictEqual({
				response: {
					body: {
						error: "The terminal\u2019s permission dialog doesn\u2019t match this card",
						code: "dialog_mismatch",
					},
					status: 409,
				},
				sendRequestCalls: [],
			});
		},
	);

	it.each([
		{decision: "allow", persistent: null, keys: ["1"]},
		{decision: "deny", persistent: null, keys: ["esc"]},
		{decision: "allow", persistent: "always", keys: ["1"]},
		{decision: "deny", persistent: "perChat", keys: ["esc"]},
	] as const)(
		"sends $keys for $decision without a readable screen when the hook's persistent option is $persistent and clears the pending prompt",
		async ({decision, persistent, keys}) => {
			const requests: object[] = [];
			const cleared: string[] = [];
			const response = await handleHerdrPermission(
				request({sessionId: "session-test-100", decision}),
				dependencies({
					persistentAllow: () => persistent,
					request: async (value) => {
						requests.push(value);
						return Promise.resolve({ok: true, value: {type: "ok"}});
					},
					clearPendingPermission: (sessionId) => cleared.push(sessionId),
				}),
			);
			expect({response: await describeResponse(response), requests, cleared}).toStrictEqual({
				response: {body: {ok: true}, status: 200},
				requests: [
					{
						id: "ccp:permission:test-100",
						method: "agent.send_keys",
						params: {target: "w100:p100", keys},
					},
				],
				cleared: ["session-test-100"],
			});
		},
	);

	describe.each(["outsideReadFirstPrompt", "generic"] as const)(
		"on auto mode's first outside-read prompt, with the hook state read as %s",
		(dialogKind) => {
			async function answerFirstPrompt(
				decision: "allow" | "always" | "deny",
				screens: readonly string[] = [READ_OUTSIDE_AUTO_FIRST_PROMPT, ANSWERED],
			): Promise<{response: {body: unknown; status: number}; keys: unknown[]; cleared: string[]}> {
				const keys: unknown[] = [];
				const cleared: string[] = [];
				let reads = 0;
				const response = await handleHerdrPermission(
					request({sessionId: "session-test-100", decision}),
					dependencies({
						// The hook's session suggestion would say "2", which blocks outside reads everywhere.
						persistentAllow: () => "perChat",
						dialogKind: async () => Promise.resolve(dialogKind),
						readScreen: async () => {
							const screen = screens[Math.min(reads, screens.length - 1)] ?? "";
							reads++;
							return Promise.resolve({ok: true, value: screen});
						},
						request: async (value) => {
							keys.push((value as {params: {keys: unknown}}).params.keys);
							return Promise.resolve({ok: true, value: {type: "ok"}});
						},
						clearPendingPermission: (sessionId) => cleared.push(sessionId),
					}),
				);
				return {response: await describeResponse(response), keys, cleared};
			}

			it("allows once with row 4, which writes nothing lasting", async () => {
				expect(await answerFirstPrompt("allow")).toStrictEqual({
					response: {body: {ok: true}, status: 200},
					keys: [["4"]],
					cleared: ["session-test-100"],
				});
			});

			it("takes the one-time row's digit from the screen, not a constant", async () => {
				const swapped = READ_OUTSIDE_AUTO_FIRST_PROMPT.replace(
					"3. No, and ask again next time\n   4. Yes, but ask again next time",
					"3. Yes, but ask again next time\n   4. No, and ask again next time",
				);
				expect(await answerFirstPrompt("allow", [swapped, ANSWERED])).toStrictEqual({
					response: {body: {ok: true}, status: 200},
					keys: [["3"]],
					cleared: ["session-test-100"],
				});
			});

			it("denies with Esc", async () => {
				expect(await answerFirstPrompt("deny")).toStrictEqual({
					response: {body: {ok: true}, status: 200},
					keys: [["esc"]],
					cleared: ["session-test-100"],
				});
			});

			it("refuses always, since no row is a session-only grant", async () => {
				expect(await answerFirstPrompt("always")).toStrictEqual({
					response: {
						body: {
							error: "The terminal offers no session-only grant for this read",
							code: "dialog_mismatch",
						},
						status: 409,
					},
					keys: [],
					cleared: [],
				});
			});

			it("keeps the prompt pending when the prompt is still on screen after the keys", async () => {
				expect(await answerFirstPrompt("allow", [READ_OUTSIDE_AUTO_FIRST_PROMPT])).toStrictEqual({
					response: {
						body: {
							error: "The terminal\u2019s permission dialog didn\u2019t take the answer",
							code: "not_accepted",
						},
						status: 409,
					},
					keys: [["4"]],
					cleared: [],
				});
			});
		},
	);

	it("keeps the prompt pending when herdr rejects the keys", async () => {
		const cleared: string[] = [];
		const response = await handleHerdrPermission(
			request({sessionId: "session-test-100", decision: "allow"}),
			dependencies({
				request: async () => Promise.resolve({ok: false, code: "agent_not_ready", message: "Fabricated"}),
				clearPendingPermission: (sessionId) => cleared.push(sessionId),
			}),
		);
		expect({response: await describeResponse(response), cleared}).toStrictEqual({
			response: {body: {error: "Fabricated"}, status: 409},
			cleared: [],
		});
	});

	describe("with the dialog read off the screen", () => {
		async function answer(
			screens: readonly string[],
			decision: "allow" | "always" | "deny",
		): Promise<{response: {body: unknown; status: number}; keys: unknown[]; cleared: string[]}> {
			const keys: unknown[] = [];
			const cleared: string[] = [];
			let reads = 0;
			const response = await handleHerdrPermission(
				request({sessionId: "session-test-100", decision}),
				dependencies({
					// The hook's suggestion would say "2"; the screen must win over it.
					persistentAllow: () => "perChat",
					readScreen: async () => {
						const screen = screens[Math.min(reads, screens.length - 1)] ?? "";
						reads++;
						return Promise.resolve({ok: true, value: screen});
					},
					request: async (value) => {
						keys.push((value as {params: {keys: unknown}}).params.keys);
						return Promise.resolve({ok: true, value: {type: "ok"}});
					},
					clearPendingPermission: (sessionId) => cleared.push(sessionId),
				}),
			);
			return {response: await describeResponse(response), keys, cleared};
		}

		const ok = {body: {ok: true}, status: 200};
		const mismatch = {
			body: {
				error: "The terminal\u2019s permission dialog doesn\u2019t match this card",
				code: "dialog_mismatch",
			},
			status: 409,
		};

		it.each([
			{name: "BASH_FULL", screen: BASH_FULL, decision: "always", keys: [["2"]]},
			{name: "WEBFETCH", screen: WEBFETCH, decision: "always", keys: [["2"]]},
			{name: "WEBFETCH", screen: WEBFETCH, decision: "deny", keys: [["esc"]]},
			{name: "EDIT_ACCEPT_EDITS_ROW", screen: EDIT_ACCEPT_EDITS_ROW, decision: "always", keys: [["2"]]},
			{name: "READ_OUTSIDE_SESSION_DIR", screen: READ_OUTSIDE_SESSION_DIR, decision: "always", keys: [["2"]]},
			{
				name: "BASH_FULL_NO_FEEDBACK_TYPED",
				screen: BASH_FULL_NO_FEEDBACK_TYPED,
				decision: "allow",
				keys: [["1"]],
			},
		] as const)("sends $keys for $decision on $name", async ({screen, decision, keys}) => {
			expect(await answer([screen, ANSWERED], decision)).toStrictEqual({
				response: ok,
				keys,
				cleared: ["session-test-100"],
			});
		});

		it("refuses always on a dialog with no persistent row, though the hook offered one", async () => {
			expect(await answer([BASH_UNICODE_WHITESPACE], "always")).toStrictEqual({
				response: mismatch,
				keys: [],
				cleared: [],
			});
		});

		it("refuses a permission question whose rows it cannot read", async () => {
			expect(
				await answer(
					[" Do you want to proceed?\n ❯ 1. Yes\n   2. Perhaps\n   3. No\n\n Esc to cancel"],
					"allow",
				),
			).toStrictEqual({response: mismatch, keys: [], cleared: []});
		});

		it("falls back to the hook's keys when the screen shows no permission question", async () => {
			expect(await answer(["$ "], "always")).toStrictEqual({
				response: ok,
				keys: [["2"]],
				cleared: ["session-test-100"],
			});
		});

		it("moves down onto Yes and presses Enter on the hidden classifier fallback", async () => {
			const onYes = CLASSIFIER_FALLBACK.replace(" ❯ No\n   Yes", "   No\n ❯ Yes");
			expect(await answer([CLASSIFIER_FALLBACK, onYes, ANSWERED], "allow")).toStrictEqual({
				response: ok,
				keys: [["down"], ["enter"]],
				cleared: ["session-test-100"],
			});
		});

		it("stops after Down when the hidden classifier fallback did not move onto Yes", async () => {
			expect(await answer([CLASSIFIER_FALLBACK], "allow")).toStrictEqual({
				response: mismatch,
				keys: [["down"]],
				cleared: [],
			});
		});

		it("keeps the prompt pending when the dialog is still on screen after the keys, as a disabled Yes row ignores its digit", async () => {
			expect(await answer([BASH_ASK_RULE], "allow")).toStrictEqual({
				response: {
					body: {
						error: "The terminal\u2019s permission dialog didn\u2019t take the answer",
						code: "not_accepted",
					},
					status: 409,
				},
				keys: [["1"]],
				cleared: [],
			});
		});
	});
});

describe("herdr permission allow and switch to auto", () => {
	const SHIFT_TAB_3 = ["shift+tab", "shift+tab", "shift+tab"];
	const mismatch = {
		body: {
			error: "The terminal\u2019s permission dialog doesn\u2019t match this card",
			code: "dialog_mismatch",
		},
		status: 409,
	};

	async function allowAuto(
		screens: readonly string[] | null,
		body: Record<string, unknown> = {presses: 3},
		overrides: Partial<HerdrPermissionDependencies> = {},
	): Promise<{response: {body: unknown; status: number}; keys: unknown[]; cleared: string[]; reads: number}> {
		const keys: unknown[] = [];
		const cleared: string[] = [];
		let reads = 0;
		const response = await handleHerdrPermission(
			request({sessionId: "session-test-100", decision: "allowAuto", ...body}),
			dependencies({
				readScreen: async () => {
					reads++;
					if (screens === null) {
						return Promise.resolve({ok: false, code: "bad-response", message: "Fabricated read failure"});
					}
					return Promise.resolve({ok: true, value: screens[Math.min(reads - 1, screens.length - 1)] ?? ""});
				},
				request: async (value) => {
					keys.push((value as {params: {keys: unknown}}).params.keys);
					return Promise.resolve({ok: true, value: {type: "ok"}});
				},
				clearPendingPermission: (sessionId) => cleared.push(sessionId),
				...overrides,
			}),
		);
		return {response: await describeResponse(response), keys, cleared, reads};
	}

	it('presses the CLI\'s own "Yes, and switch to auto mode" row when it is on screen', async () => {
		expect(await allowAuto([BASH_FULL, ANSWERED])).toStrictEqual({
			response: {body: {ok: true, via: "row"}, status: 200},
			keys: [["3"]],
			cleared: ["session-test-100"],
			reads: 2,
		});
	});

	it("presses the auto row's own digit when the persistent row is withheld", async () => {
		expect((await allowAuto([BASH_UNICODE_WHITESPACE, ANSWERED])).keys).toStrictEqual([["2"]]);
	});

	it("allows once, then steps the mode with shift+tab once the screen shows no dialog", async () => {
		expect(await allowAuto([BASH_ASK_RULE, ANSWERED, ANSWERED])).toStrictEqual({
			response: {body: {ok: true, via: "shiftTab"}, status: 200},
			keys: [["1"], SHIFT_TAB_3],
			cleared: ["session-test-100"],
			reads: 3,
		});
	});

	it.each([
		{name: "the next permission dialog", next: BASH_FULL},
		{name: "a plan dialog", next: PLAN_DIALOG},
		{name: "auto mode's first outside-read prompt", next: READ_OUTSIDE_AUTO_FIRST_PROMPT},
	])("sends no shift+tab when $name takes the screen after the allow", async ({next}) => {
		expect(await allowAuto([BASH_ASK_RULE, next, next])).toStrictEqual({
			response: {body: {ok: true, via: "none"}, status: 200},
			keys: [["1"]],
			cleared: ["session-test-100"],
			reads: 3,
		});
	});

	it("sends no shift+tab when the screen can't be read after the allow", async () => {
		let reads = 0;
		const result = await allowAuto(
			[],
			{presses: 3},
			{
				readScreen: async () => {
					reads++;
					return Promise.resolve(
						reads === 1
							? {ok: true, value: BASH_ASK_RULE}
							: {ok: false, code: "bad-response", message: "Fabricated read failure"},
					);
				},
			},
		);
		expect({response: result.response, keys: result.keys}).toStrictEqual({
			response: {body: {ok: true, via: "none"}, status: 200},
			keys: [["1"]],
		});
	});

	it.each([
		{name: "an unreadable screen", screens: null},
		{name: "a screen with no dialog", screens: [ANSWERED]},
		{name: "a deny-first dialog", screens: [CLASSIFIER_FALLBACK]},
		{name: "auto mode's first outside-read prompt", screens: [READ_OUTSIDE_AUTO_FIRST_PROMPT]},
	])("refuses $name without sending a key", async ({screens}) => {
		const result = await allowAuto(screens);
		expect({response: result.response, keys: result.keys, cleared: result.cleared}).toStrictEqual({
			response: mismatch,
			keys: [],
			cleared: [],
		});
	});

	it("answers 409 not_accepted when the dialog stays after the auto row's digit", async () => {
		const result = await allowAuto([BASH_FULL]);
		expect({response: result.response, keys: result.keys, cleared: result.cleared}).toStrictEqual({
			response: {
				body: {
					error: "The terminal\u2019s permission dialog didn\u2019t take the answer",
					code: "not_accepted",
				},
				status: 409,
			},
			keys: [["3"]],
			cleared: [],
		});
	});

	it("refuses with no pending prompt before reading the screen", async () => {
		expect(await allowAuto([BASH_FULL], {presses: 3}, {hasPendingPermission: () => false})).toStrictEqual({
			response: {body: {error: "No permission request is pending", code: "not_pending"}, status: 409},
			keys: [],
			cleared: [],
			reads: 0,
		});
	});

	it("presses the auto row without a shift+tab count", async () => {
		expect((await allowAuto([BASH_FULL, ANSWERED], {})).keys).toStrictEqual([["3"]]);
	});

	it("refuses without a shift+tab count when the auto row isn't on screen", async () => {
		const result = await allowAuto([BASH_ASK_RULE, ANSWERED], {});
		expect({response: result.response, keys: result.keys, cleared: result.cleared}).toStrictEqual({
			response: mismatch,
			keys: [],
			cleared: [],
		});
	});

	it.each([{presses: 0}, {presses: 5}, {presses: 1.5}, {presses: "3"}])("returns 400 for %o", async (body) => {
		expect(await allowAuto([BASH_FULL], body)).toStrictEqual({
			response: {
				body: {error: 'sessionId is required and decision must be "allow", "always", "deny", or "allowAuto"'},
				status: 400,
			},
			keys: [],
			cleared: [],
			reads: 0,
		});
	});
});

describe("herdr permission dialog shape", () => {
	async function readShape(
		screen: string,
		overrides: Partial<HerdrPermissionDependencies> = {},
	): Promise<{body: unknown; status: number}> {
		const response = await handleHerdrPermissionDialog(
			new Request("http://127.0.0.1:7526/api/herdr/permission?sessionId=session-test-100"),
			dependencies({readScreen: async () => Promise.resolve({ok: true, value: screen}), ...overrides}),
		);
		return describeResponse(response);
	}

	it.each([
		{name: "BASH_FULL", screen: BASH_FULL, dialog: {denyFirst: false, persistent: true, auto: true}},
		{
			name: "CLASSIFIER_FALLBACK",
			screen: CLASSIFIER_FALLBACK,
			dialog: {denyFirst: true, persistent: false, auto: false},
		},
		{
			name: "BASH_UNICODE_WHITESPACE",
			screen: BASH_UNICODE_WHITESPACE,
			dialog: {denyFirst: false, persistent: false, auto: true},
		},
		{name: "BASH_ASK_RULE", screen: BASH_ASK_RULE, dialog: {denyFirst: false, persistent: false, auto: false}},
		{name: "WEBFETCH", screen: WEBFETCH, dialog: {denyFirst: false, persistent: true, auto: false}},
	])("reads $name as $dialog", async ({screen, dialog}) => {
		expect(await readShape(screen)).toStrictEqual({body: {dialog}, status: 200});
	});

	it.each(["outsideReadFirstPrompt", "generic"] as const)(
		"reads auto mode's first outside-read prompt as a card with no persistent option, with the hook state read as %s",
		async (dialogKind) => {
			expect(
				await readShape(READ_OUTSIDE_AUTO_FIRST_PROMPT, {
					persistentAllow: () => "perChat",
					dialogKind: async () => Promise.resolve(dialogKind),
				}),
			).toStrictEqual({body: {dialog: {denyFirst: false, persistent: false, auto: false}}, status: 200});
		},
	);

	it("answers 409 dialog_not_shown when the screen shows no permission dialog", async () => {
		expect(await readShape(PLAN_DIALOG)).toStrictEqual({
			body: {error: "The terminal is not showing the permission dialog", code: "dialog_not_shown"},
			status: 409,
		});
	});

	it("answers 409 not_pending without reading the screen when no prompt is pending", async () => {
		const readScreen = vi.fn<HerdrPermissionDependencies["readScreen"]>();
		expect({
			response: await readShape(BASH_FULL, {hasPendingPermission: () => false, readScreen}),
			reads: readScreen.mock.calls,
		}).toStrictEqual({
			response: {body: {error: "No permission request is pending", code: "not_pending"}, status: 409},
			reads: [],
		});
	});

	it("answers 400 without a sessionId", async () => {
		const response = await handleHerdrPermissionDialog(
			new Request("http://127.0.0.1:7526/api/herdr/permission"),
			dependencies(),
		);
		expect(await describeResponse(response)).toStrictEqual({body: {error: "sessionId is required"}, status: 400});
	});
});
