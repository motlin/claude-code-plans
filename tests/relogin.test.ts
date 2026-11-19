import {describe, expect, it} from "vite-plus/test";
import {collapsesToSignedInAgain, loginSucceededAt} from "../src/lib/relogin";
import {processTranscript} from "../src/lib/transcript";

const LOGIN_AT = "2026-10-06T12:08:53.873Z";

/** The liftwizard 59103d22 `/login` output record (CLI 2.1.290), trimmed to the fields the transcript reads. */
function systemLogin(timestamp: string, stdout = "Login successful"): Record<string, unknown>
{
	return {
		type: "system",
		subtype: "local_command",
		uuid: `system-login-${timestamp}`,
		timestamp,
		content: `<local-command-stdout>${stdout}</local-command-stdout>`,
		level: "info",
		commandRun:
		{
			command: "login",
			args: "",
		},
	};
}

/** The 7bh-simulator 81c67b45 shape (CLI 2.1.319): the command and its stdout as two user records. */
function userLogin(timestamp: string, stdout = "Login successful"): Record<string, unknown>[]
{
	return [
		{
			type: "user",
			uuid: `user-login-${timestamp}`,
			timestamp,
			message:
			{
				role: "user",
				content:
					"<command-name>/login</command-name>\n            <command-message>login</command-message>\n            <command-args></command-args>",
			},
		},
		{
			type: "user",
			uuid: `user-login-stdout-${timestamp}`,
			timestamp,
			message:
			{
				role: "user",
				content: `<local-command-stdout>${stdout}</local-command-stdout>`,
			},
		},
	];
}

/** The dotfiles cd177268 shape (CLI 2.1.243): the command echo and its stdout as two system records, neither naming the command. */
function unnamedSystemLogin(timestamp: string, stdout = "Login successful"): Record<string, unknown>[]
{
	return [
		{
			type: "system",
			subtype: "local_command",
			uuid: `system-echo-${timestamp}`,
			timestamp,
			content:
				"<command-name>/login</command-name>\n            <command-message>login</command-message>\n            <command-args></command-args>",
			level: "info",
			isMeta: false,
		},
		{
			type: "system",
			subtype: "local_command",
			parentUuid: `system-echo-${timestamp}`,
			uuid: `system-stdout-${timestamp}`,
			timestamp,
			content: `<local-command-stdout>${stdout}</local-command-stdout>`,
			level: "info",
			isMeta: false,
		},
	];
}

function at(records: Record<string, unknown>[]): number | null
{
	return loginSucceededAt(processTranscript(records).lines);
}

describe("loginSucceededAt", () =>
{
	it("reads a successful /login from any record shape, the latest one winning, and ignores a failed one", () =>
	{
		expect(
			{
				system: at([systemLogin(LOGIN_AT)]),
				user: at(userLogin("2026-11-09T04:20:38.407Z")),
				unnamedSystem: at(unnamedSystemLogin("2026-08-25T02:58:43.012Z")),
				failedUnnamedSystem: at(unnamedSystemLogin("2026-08-25T02:58:43.012Z", "Login failed")),
				failedSystem: at([systemLogin(LOGIN_AT, "Login failed")]),
				failedUser: at(userLogin(LOGIN_AT, "Login failed")),
				latest: at([
					systemLogin(LOGIN_AT),
					...userLogin("2026-10-07T00:00:00.000Z"),
					systemLogin("2026-10-06T00:00:00.000Z"),
				]),
				none: at([]),
			},
		).toStrictEqual(
			{
				system: Date.parse(LOGIN_AT),
				user: Date.parse("2026-11-09T04:20:38.407Z"),
				unnamedSystem: Date.parse("2026-08-25T02:58:43.012Z"),
				failedUnnamedSystem: null,
				failedSystem: null,
				failedUser: null,
				latest: Date.parse("2026-10-07T00:00:00.000Z"),
				none: null,
			},
		);
	});
});

describe("collapsesToSignedInAgain", () =>
{
	it("collapses only an auth error strictly older than the relogin", () =>
	{
		const relogin = Date.parse("2026-08-25T02:58:43.012Z");

		expect(
			{
				before: collapsesToSignedInAgain(
					{
						category: "auth",
						timestamp: "2026-08-25T02:57:20.089Z",
					},
					relogin,
				),
				sameMs: collapsesToSignedInAgain(
					{
						category: "auth",
						timestamp: "2026-08-25T02:58:43.012Z",
					},
					relogin,
				),
				after: collapsesToSignedInAgain(
					{
						category: "auth",
						timestamp: "2026-08-25T03:00:00.000Z",
					},
					relogin,
				),
				overloaded: collapsesToSignedInAgain(
					{
						category: "overloaded",
						timestamp: "2026-08-25T02:57:20.089Z",
					},
					relogin,
				),
				noTimestamp: collapsesToSignedInAgain(
					{
						category: "auth",
						timestamp: undefined,
					},
					relogin,
				),
				badTimestamp: collapsesToSignedInAgain(
					{
						category: "auth",
						timestamp: "yesterday-ish",
					},
					relogin,
				),
				noRelogin: collapsesToSignedInAgain(
					{
						category: "auth",
						timestamp: "2026-08-25T02:57:20.089Z",
					},
					null,
				),
			},
		).toStrictEqual(
			{
				before: true,
				sameMs: false,
				after: false,
				overloaded: false,
				noTimestamp: false,
				badTimestamp: false,
				noRelogin: false,
			},
		);
	});
});
