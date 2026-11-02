import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {openTestDb} from "../src/lib/db/connection";
import
{
	type ConsentStoreDependencies,
	handlePermissionModeConsentGet,
	handlePermissionModeConsentPost,
} from "../src/lib/permission-mode-consent-server";

let home: string;
let claudeDir: string;
let dependencies: ConsentStoreDependencies;

beforeEach(() =>
{
	home = mkdtempSync(join(tmpdir(), "consent-home-"));
	claudeDir = join(home, ".claude");
	mkdirSync(claudeDir);
	dependencies =
	{
		db: openTestDb().index,
		claudeDir,
		configDir: home,
		readManagedSettings: async () => Promise.resolve({}),
	};
});

afterEach(() =>
{
	rmSync(
		home,
		{
			recursive: true,
			force: true,
		},
	);
});

function writeSettings(settings: unknown)
{
	writeFileSync(join(claudeDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
}

function post(body: unknown, headers: Record<string, string> = {})
{
	return new Request(
		"http://localhost/api/permission-mode-consent",
		{
			method: "POST",
			headers:
			{
				"Content-Type": "application/json",
				...headers,
			},
			body: JSON.stringify(body),
		},
	);
}

async function getState(): Promise<unknown>
{
	return (await handlePermissionModeConsentGet(dependencies)).json();
}

describe("GET /api/permission-mode-consent", () =>
{
	it("reads auto-is-default from settings and the auto consent from .claude.json", async () =>
	{
		const nothing = await getState();
		writeSettings(
			{
				permissions:
				{
					defaultMode: "default",
				},
				skipAutoPermissionPrompt: true,
			},
		);
		writeFileSync(
			join(home, ".claude.json"),
			JSON.stringify(
				{
					hasSeenAutoModeEntryWarning: true,
				},
			),
		);
		const optedIn = await getState();
		writeSettings(
			{
				permissions:
				{
					defaultMode: "acceptEdits",
				},
			},
		);
		const acceptEdits = await getState();
		writeSettings(
			{
				permissions:
				{
					defaultMode: "auto",
				},
			},
		);
		const autoDefault = await getState();
		writeSettings({});
		dependencies =
		{
			...dependencies,
			readManagedSettings: async () =>
				Promise.resolve(
					{
						skipAutoPermissionPrompt: true,
					},
				),
		};
		const policy = await getState();

		expect(
			{
				nothing,
				optedIn,
				acceptEdits,
				autoDefault,
				policy,
			},
		).toStrictEqual(
			{
				nothing:
				{
					autoModeIsDefault: false,
					autoConsented: false,
					acks: [],
				},
				optedIn:
				{
					autoModeIsDefault: true,
					autoConsented: true,
					acks: [],
				},
				acceptEdits:
				{
					autoModeIsDefault: false,
					autoConsented: true,
					acks: [],
				},
				autoDefault:
				{
					autoModeIsDefault: true,
					autoConsented: true,
					acks: [],
				},
				policy:
				{
					autoModeIsDefault: true,
					autoConsented: true,
					acks: [],
				},
			},
		);
	});
});

describe("POST /api/permission-mode-consent", () =>
{
	it("stores a deduped bypass ack per workspace and the CLI's own bypass opt-in", async () =>
	{
		writeSettings(
			{
				permissions:
				{
					defaultMode: "bypassPermissions",
				},
			},
		);
		const first = await handlePermissionModeConsentPost(
			post(
				{
					mode: "bypassPermissions",
					workspace: "/w",
				},
			),
			dependencies,
		);
		const second = await handlePermissionModeConsentPost(
			post(
				{
					mode: "bypassPermissions",
					workspace: "/w",
				},
			),
			dependencies,
		);
		const none = await handlePermissionModeConsentPost(
			post(
				{
					mode: "bypassPermissions",
					workspace: "",
				},
			),
			dependencies,
		);

		expect(
			{
				first: [first.status, await first.json()],
				second: await second.json(),
				none: await none.json(),
				settings: readFileSync(join(claudeDir, "settings.json"), "utf-8"),
			},
		).toStrictEqual(
			{
				first: [
					200,
					{
						autoModeIsDefault: false,
						autoConsented: false,
						acks: ["/w:bypassPermissions"],
					},
				],
				second:
				{
					autoModeIsDefault: false,
					autoConsented: false,
					acks: ["/w:bypassPermissions"],
				},
				none:
				{
					autoModeIsDefault: false,
					autoConsented: false,
					acks: ["/w:bypassPermissions"],
				},
				settings: `{\n  "permissions": {\n    "defaultMode": "bypassPermissions"\n  },\n  "skipDangerousModePermissionPrompt": true\n}\n`,
			},
		);
	});

	it("records the auto consent as the CLI's hasSeenAutoModeEntryWarning, keeping the rest of .claude.json", async () =>
	{
		const original = `{\n  "numStartups": 3,\n  "projects": {\n    "/w": {\n      "hasTrustDialogAccepted": true\n    }\n  }\n}`;
		writeFileSync(join(home, ".claude.json"), original);
		const response = await handlePermissionModeConsentPost(
			post(
				{
					mode: "auto",
					workspace: "/w",
				},
			),
			dependencies,
		);
		const written = readFileSync(join(home, ".claude.json"), "utf-8");
		const again = await handlePermissionModeConsentPost(
			post(
				{
					mode: "auto",
					workspace: "/w",
				},
			),
			dependencies,
		);

		expect(
			{
				state: await response.json(),
				written,
				unchanged: readFileSync(join(home, ".claude.json"), "utf-8") === written,
				again: await again.json(),
			},
		).toStrictEqual(
			{
				state:
				{
					autoModeIsDefault: false,
					autoConsented: true,
					acks: [],
				},
				written: `{\n  "numStartups": 3,\n  "projects": {\n    "/w": {\n      "hasTrustDialogAccepted": true\n    }\n  },\n  "hasSeenAutoModeEntryWarning": true\n}`,
				unchanged: true,
				again:
				{
					autoModeIsDefault: false,
					autoConsented: true,
					acks: [],
				},
			},
		);
	});

	it("creates .claude.json when the CLI hasn't written one", async () =>
	{
		await handlePermissionModeConsentPost(
			post(
				{
					mode: "auto",
					workspace: "",
				},
			),
			dependencies,
		);
		expect(JSON.parse(readFileSync(join(home, ".claude.json"), "utf-8"))).toStrictEqual(
			{
				hasSeenAutoModeEntryWarning: true,
			},
		);
	});

	it("rejects a cross-site POST and a bad body, and stores nothing", async () =>
	{
		const crossSite = await handlePermissionModeConsentPost(
			post(
				{
					mode: "bypassPermissions",
					workspace: "/w",
				},
				{
					Origin: "https://evil.example",
				},
			),
			dependencies,
		);
		const badMode = await handlePermissionModeConsentPost(
			post(
				{
					mode: "plan",
					workspace: "/w",
				},
			),
			dependencies,
		);
		expect(
			{
				crossSite: crossSite.status,
				badMode: badMode.status,
				state: await getState(),
			},
		).toStrictEqual(
			{
				crossSite: 403,
				badMode: 400,
				state:
				{
					autoModeIsDefault: false,
					autoConsented: false,
					acks: [],
				},
			},
		);
	});

	it("leaves .claude.json alone when it isn't valid JSON", async () =>
	{
		writeFileSync(join(home, ".claude.json"), "{not json");
		const response = await handlePermissionModeConsentPost(
			post(
				{
					mode: "auto",
					workspace: "",
				},
			),
			dependencies,
		);
		expect(
			{
				status: response.status,
				file: readFileSync(join(home, ".claude.json"), "utf-8"),
			},
		).toStrictEqual(
			{
				status: 500,
				file: "{not json",
			},
		);
	});
});
