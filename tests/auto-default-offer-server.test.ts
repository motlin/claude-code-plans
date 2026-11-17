import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import
{
	type AutoDefaultOfferDependencies,
	handleAutoDefaultOfferGet,
	handleAutoDefaultOfferPost,
} from "../src/lib/auto-default-offer-server";

let home: string;
let claudeDir: string;
let dependencies: AutoDefaultOfferDependencies;

beforeEach(() =>
{
	home = mkdtempSync(join(tmpdir(), "auto-default-home-"));
	claudeDir = join(home, ".claude");
	mkdirSync(claudeDir);
	dependencies =
	{
		claudeDir,
		configDir: home,
		readManagedSettings: async () => Promise.reject(new Error("ENOENT")),
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

const settingsPath = () => join(claudeDir, "settings.json");
const configPath = () => join(home, ".claude.json");

function writeSettings(settings: unknown)
{
	writeFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
}

function writeConfig(config: unknown)
{
	writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

function post(body: unknown, headers: Record<string, string> = {})
{
	return new Request(
		"http://localhost/api/auto-default-offer",
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
	return (await handleAutoDefaultOfferGet(dependencies)).json();
}

async function postStatus(body: unknown): Promise<
{
	status: number;
	json: unknown;
}>
{
	const response = await handleAutoDefaultOfferPost(post(body), dependencies);
	return {
		status: response.status,
		json: await response.json(),
	};
}

const OFF =
{
	noticeEligible: false,
	nudgeMode: null,
};

describe("GET /api/auto-default-offer", () =>
{
	it("stays quiet on this machine: notice seen, defaultMode auto", async () =>
	{
		writeConfig(
			{
				hasCompletedOnboarding: true,
				hasSeenAutoDefaultNotice: true,
			},
		);
		writeSettings(
			{
				permissions:
				{
					defaultMode: "auto",
				},
			},
		);
		expect(await getState()).toStrictEqual(OFF);
	});

	it("offers the notice when onboarded and no layer sets defaultMode (the CLI's Auto fallback)", async () =>
	{
		writeConfig(
			{
				hasCompletedOnboarding: true,
			},
		);
		writeSettings({});
		expect(await getState()).toStrictEqual(
			{
				noticeEligible: true,
				nudgeMode: null,
			},
		);
	});

	it("ports the CLI's TLo nudge gate", async () =>
	{
		writeConfig(
			{
				hasCompletedOnboarding: true,
			},
		);
		writeSettings(
			{
				permissions:
				{
					defaultMode: "acceptEdits",
				},
			},
		);
		const eligible = await getState();
		writeConfig(
			{
				hasCompletedOnboarding: true,
				hasSeenAutoDefaultNudge: true,
			},
		);
		const seen = await getState();
		writeConfig(
			{
				hasCompletedOnboarding: true,
				cachedGrowthBookFeatures:
				{
					tengu_maple_pier: false,
				},
			},
		);
		const gatedOff = await getState();
		writeConfig(
			{
				hasCompletedOnboarding: true,
				cachedGrowthBookFeatures:
				{
					tengu_maple_pier: true,
				},
			},
		);
		const gatedOn = await getState();
		expect(
			{
				eligible,
				seen,
				gatedOff,
				gatedOn,
			},
		).toStrictEqual(
			{
				eligible:
				{
					noticeEligible: false,
					nudgeMode: "acceptEdits",
				},
				seen: OFF,
				gatedOff: OFF,
				gatedOn:
				{
					noticeEligible: false,
					nudgeMode: "acceptEdits",
				},
			},
		);
	});

	it("is off under a policy defaultMode, before onboarding, and on unreadable files", async () =>
	{
		writeConfig(
			{
				hasCompletedOnboarding: true,
			},
		);
		writeSettings(
			{
				permissions:
				{
					defaultMode: "plan",
				},
			},
		);
		dependencies =
		{
			...dependencies,
			readManagedSettings: async () =>
				Promise.resolve(
					{
						permissions:
						{
							defaultMode: "default",
						},
					},
				),
		};
		const policy = await getState();
		writeSettings({});
		const policyNoUser = await getState();
		dependencies =
		{
			...dependencies,
			readManagedSettings: async () => Promise.resolve({}),
		};
		writeConfig({});
		const notOnboarded = await getState();
		writeFileSync(configPath(), "{not json");
		const badConfig = await getState();
		writeConfig(
			{
				hasCompletedOnboarding: true,
			},
		);
		writeFileSync(settingsPath(), "{not json");
		const badSettings = await getState();
		rmSync(configPath());
		const noConfig = await getState();
		expect(
			{
				policy,
				policyNoUser,
				notOnboarded,
				badConfig,
				badSettings,
				noConfig,
			},
		).toStrictEqual(
			{
				policy: OFF,
				policyNoUser: OFF,
				notOnboarded: OFF,
				badConfig: OFF,
				badSettings: OFF,
				noConfig: OFF,
			},
		);
	});
});

describe("POST /api/auto-default-offer", () =>
{
	it("marks the notice seen in .claude.json the way the CLI's own notice does", async () =>
	{
		writeConfig(
			{
				hasCompletedOnboarding: true,
				other: [1, 2],
			},
		);
		writeSettings({});
		const first = await postStatus(
			{
				surface: "notice",
			},
		);
		const afterFirst = readFileSync(configPath(), "utf-8");
		const second = await postStatus(
			{
				surface: "notice",
			},
		);
		expect(
			{
				first,
				second,
				config: JSON.parse(afterFirst) as unknown,
				unchanged: readFileSync(configPath(), "utf-8") === afterFirst,
			},
		).toStrictEqual(
			{
				first:
				{
					status: 200,
					json: OFF,
				},
				second:
				{
					status: 200,
					json: OFF,
				},
				config:
				{
					hasCompletedOnboarding: true,
					other: [1, 2],
					hasSeenAutoDefaultNotice: true,
				},
				unchanged: true,
			},
		);
	});

	it("accept writes defaultMode auto, keeping the file's formatting, then marks the nudge seen like the CLI's ALo", async () =>
	{
		writeConfig(
			{
				hasCompletedOnboarding: true,
			},
		);
		writeFileSync(
			settingsPath(),
			'{\n    "permissions": {\n        "allow": ["Bash(ls)"],\n        "defaultMode": "acceptEdits"\n    }\n}\n',
		);
		const result = await postStatus(
			{
				surface: "nudge",
				choice: "accept",
			},
		);
		expect(
			{
				result,
				settings: readFileSync(settingsPath(), "utf-8"),
				config: JSON.parse(readFileSync(configPath(), "utf-8")) as unknown,
			},
		).toStrictEqual(
			{
				result:
				{
					status: 200,
					json: OFF,
				},
				settings:
					'{\n    "permissions": {\n        "allow": ["Bash(ls)"],\n        "defaultMode": "auto"\n    }\n}\n',
				config:
				{
					hasCompletedOnboarding: true,
					hasSeenAutoDefaultNudge: true,
				},
			},
		);
	});

	it("decline leaves settings byte-identical and marks the nudge seen", async () =>
	{
		writeConfig(
			{
				hasCompletedOnboarding: true,
			},
		);
		writeSettings(
			{
				permissions:
				{
					defaultMode: "default",
				},
			},
		);
		const before = readFileSync(settingsPath(), "utf-8");
		const result = await postStatus(
			{
				surface: "nudge",
				choice: "decline",
			},
		);
		expect(
			{
				result,
				unchanged: readFileSync(settingsPath(), "utf-8") === before,
				config: JSON.parse(readFileSync(configPath(), "utf-8")) as unknown,
			},
		).toStrictEqual(
			{
				result:
				{
					status: 200,
					json: OFF,
				},
				unchanged: true,
				config:
				{
					hasCompletedOnboarding: true,
					hasSeenAutoDefaultNudge: true,
				},
			},
		);
	});

	it("an accept after the nudge was already answered changes nothing, as ALo returns early", async () =>
	{
		writeConfig(
			{
				hasCompletedOnboarding: true,
				hasSeenAutoDefaultNudge: true,
			},
		);
		writeSettings(
			{
				permissions:
				{
					defaultMode: "plan",
				},
			},
		);
		const before = readFileSync(settingsPath(), "utf-8");
		const result = await postStatus(
			{
				surface: "nudge",
				choice: "accept",
			},
		);
		expect(
			{
				result,
				unchanged: readFileSync(settingsPath(), "utf-8") === before,
			},
		).toStrictEqual(
			{
				result:
				{
					status: 200,
					json: OFF,
				},
				unchanged: true,
			},
		);
	});

	it("refuses an invalid settings.json with 409 and writes nothing", async () =>
	{
		writeConfig(
			{
				hasCompletedOnboarding: true,
			},
		);
		writeFileSync(settingsPath(), "{not json");
		const configBefore = readFileSync(configPath(), "utf-8");
		const result = await postStatus(
			{
				surface: "nudge",
				choice: "accept",
			},
		);
		expect(
			{
				result,
				settings: readFileSync(settingsPath(), "utf-8"),
				configUnchanged: readFileSync(configPath(), "utf-8") === configBefore,
			},
		).toStrictEqual(
			{
				result:
				{
					status: 409,
					json:
					{
						error: "settings.json is not valid JSON",
					},
				},
				settings: "{not json",
				configUnchanged: true,
			},
		);
	});

	it("rejects bad bodies and cross-site requests", async () =>
	{
		const unknownSurface = await postStatus(
			{
				surface: "banner",
			},
		);
		const nudgeWithoutChoice = await postStatus(
			{
				surface: "nudge",
			},
		);
		const crossSite = await handleAutoDefaultOfferPost(
			post(
				{
					surface: "notice",
				},
				{
					Origin: "https://evil.example",
				},
			),
			dependencies,
		);
		expect(
			{
				unknownSurface,
				nudgeWithoutChoice,
				crossSite: crossSite.status,
			},
		).toStrictEqual(
			{
				unknownSurface:
				{
					status: 400,
					json:
					{
						error: 'Expected { surface: "notice" } or { surface: "nudge", choice }',
					},
				},
				nudgeWithoutChoice:
				{
					status: 400,
					json:
					{
						error: 'Expected { surface: "notice" } or { surface: "nudge", choice }',
					},
				},
				crossSite: 403,
			},
		);
	});
});
