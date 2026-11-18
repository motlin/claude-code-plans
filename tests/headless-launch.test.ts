import {describe, expect, it} from "vite-plus/test";

import {handleHeadlessLaunch, type HeadlessLaunchDependencies} from "../src/lib/headless/launch";
import type {HeadlessLaunch} from "../src/lib/headless/registry";

function dependencies(launches: HeadlessLaunch[], writesEnabled = true): HeadlessLaunchDependencies
{
	return {
		rejectRequest: () => null,
		writesEnabled: () => writesEnabled,
		homeDir: () => "/Users/alice",
		launch: (launch) =>
		{
			launches.push(launch);
			return {
				sessionId: "headless-session-alice",
			};
		},
	};
}

function post(body: object): Request
{
	return new Request(
		"http://localhost/api/headless/launch",
		{
			method: "POST",
			body: JSON.stringify(body),
		},
	);
}

describe("handleHeadlessLaunch", () =>
{
	it("launches with the request's folder, prompt and flags and answers the new session id", async () =>
	{
		const launches: HeadlessLaunch[] = [];

		const response = await handleHeadlessLaunch(
			post(
				{
					cwd: "/fixture/alice-project",
					prompt: "Say pong",
					args: ["--model", "haiku"],
				},
			),
			dependencies(launches),
		);

		expect(
			{
				status: response.status,
				body: await response.json(),
				launches,
			},
		).toStrictEqual(
			{
				status: 200,
				body:
				{
					ok: true,
					sessionId: "headless-session-alice",
				},
				launches: [
					{
						cwd: "/fixture/alice-project",
						prompt: "Say pong",
						args: ["--model", "haiku"],
					},
				],
			},
		);
	});

	it("starts in the home directory without a folder", async () =>
	{
		const launches: HeadlessLaunch[] = [];

		await handleHeadlessLaunch(post({}), dependencies(launches));

		expect(launches).toStrictEqual([
			{
				cwd: "/Users/alice",
			},
		]);
	});

	it("refuses while Live terminal input is off and launches nothing", async () =>
	{
		const launches: HeadlessLaunch[] = [];

		const response = await handleHeadlessLaunch(
			post(
				{
					prompt: "Say pong",
				},
			),
			dependencies(launches, false),
		);

		expect(
			{
				status: response.status,
				launches,
			},
		).toStrictEqual(
			{
				status: 403,
				launches: [],
			},
		);
	});
});
