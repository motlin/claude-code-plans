import {afterEach, describe, expect, it} from "vite-plus/test";
import {SERVER_PROCESS_TITLE, setServerProcessTitle} from "../src/lib/server-process-title";

const originalTitle = process.title;

afterEach(() =>
{
	process.title = originalTitle;
});

describe("production server process title", () =>
{
	it("names the production process so it is identifiable in ps", () =>
	{
		setServerProcessTitle(
			{
				dev: false,
			},
		);

		expect(
			{
				constant: SERVER_PROCESS_TITLE,
				title: process.title,
			},
		).toStrictEqual(
			{
				constant: "claude-code-browser-server",
				title: "claude-code-browser-server",
			},
		);
	});

	// scripts/server.sh passes its SERVER_TITLE, so a test run can give its server a title no real server has.
	it("takes the title scripts/server.sh passes in SERVER_TITLE", () =>
	{
		setServerProcessTitle(
			{
				dev: false,
				env:
				{
					SERVER_TITLE: "ccb-test-server-fake-run",
				},
			},
		);

		expect(process.title).toBe("ccb-test-server-fake-run");
	});

	it("leaves the dev process title alone", () =>
	{
		setServerProcessTitle(
			{
				dev: true,
			},
		);

		expect(process.title).toBe(originalTitle);
	});
});
