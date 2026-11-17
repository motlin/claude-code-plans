import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import
{
	type AutoModeSetupDependencies,
	handleAutoModeSetupGet,
	readAutoModeSetupState,
} from "../src/lib/auto-mode-setup-state";

// This machine's shape: setup already run, five classifier denials recorded, the CLI offering the wizard.
const MACHINE_CLAUDE_JSON =
{
	autoModeEnvSetup:
	{
		denials: 5,
	},
	cachedGrowthBookFeatures:
	{
		tengu_auto_mode_config:
		{
			envOnboarding: true,
		},
	},
};
const WITH_ENVIRONMENT =
{
	autoMode:
	{
		environment: ["### Org-wide"],
	},
};
const OFF =
{
	offered: false,
	setupComplete: false,
	denials: 0,
	dismissed: false,
	snoozedUntil: 0,
};

describe("readAutoModeSetupState", () =>
{
	it("reads this machine's shape as offered and complete", () =>
	{
		expect(
			readAutoModeSetupState(
				{
					claudeJson: MACHINE_CLAUDE_JSON,
					userSettings: WITH_ENVIRONMENT,
				},
			),
		).toStrictEqual(
			{
				offered: true,
				setupComplete: true,
				denials: 5,
				dismissed: false,
				snoozedUntil: 0,
			},
		);
	});

	it("treats an empty environment as setup not done", () =>
	{
		expect(
			readAutoModeSetupState(
				{
					claudeJson: MACHINE_CLAUDE_JSON,
					userSettings:
					{
						autoMode:
						{
							environment: [],
						},
					},
				},
			),
		).toStrictEqual(
			{
				offered: true,
				setupComplete: false,
				denials: 5,
				dismissed: false,
				snoozedUntil: 0,
			},
		);
	});

	it("counts an environment from the project or local settings layer", () =>
	{
		expect([
			readAutoModeSetupState(
				{
					claudeJson: {},
					userSettings: {},
					projectSettings: WITH_ENVIRONMENT,
				},
			).setupComplete,
			readAutoModeSetupState(
				{
					claudeJson: {},
					userSettings: {},
					localSettings: WITH_ENVIRONMENT,
				},
			).setupComplete,
		]).toStrictEqual([true, true]);
	});

	it("snoozes for seven days after dismissedAt, and reads dismissed", () =>
	{
		expect(
			readAutoModeSetupState(
				{
					claudeJson:
					{
						autoModeEnvSetup:
						{
							denials: 2,
							dismissed: true,
							dismissedAt: 1000,
						},
					},
					userSettings: {},
				},
			),
		).toStrictEqual(
			{
				offered: false,
				setupComplete: false,
				denials: 2,
				dismissed: true,
				snoozedUntil: 604_801_000,
			},
		);
	});

	it("is not offered when the user turned the auto-mode-setup skill off", () =>
	{
		expect(
			readAutoModeSetupState(
				{
					claudeJson: MACHINE_CLAUDE_JSON,
					userSettings:
					{
						skillOverrides:
						{
							"auto-mode-setup": "off",
						},
					},
				},
			),
		).toStrictEqual(
			{
				offered: false,
				setupComplete: false,
				denials: 5,
				dismissed: false,
				snoozedUntil: 0,
			},
		);
	});

	it("gives the all-off default for an unreadable .claude.json", () =>
	{
		expect(
			readAutoModeSetupState(
				{
					claudeJson: null,
					userSettings: null,
				},
			),
		).toStrictEqual(OFF);
	});
});

describe("handleAutoModeSetupGet", () =>
{
	let home: string;
	let project: string;
	let dependencies: AutoModeSetupDependencies;

	beforeEach(() =>
	{
		home = mkdtempSync(join(tmpdir(), "auto-mode-setup-home-"));
		project = join(home, "project");
		mkdirSync(join(home, ".claude"));
		mkdirSync(
			join(project, ".claude"),
			{
				recursive: true,
			},
		);
		dependencies =
		{
			claudeDir: join(home, ".claude"),
			configDir: home,
			knownProjectPaths: async () => Promise.resolve([project]),
			sessionHistoryCount: () => 7,
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

	const get = async (query = "") =>
	{
		const response = await handleAutoModeSetupGet(
			new Request(`http://localhost/api/auto-mode-setup${query}`),
			dependencies,
		);
		return {
			status: response.status,
			json: (await response.json()) as unknown,
		};
	};

	it("reads the CLI's own files and the session count", async () =>
	{
		writeFileSync(join(home, ".claude.json"), JSON.stringify(MACHINE_CLAUDE_JSON));
		writeFileSync(
			join(home, ".claude", "settings.json"),
			JSON.stringify(
				{
					permissions:
					{
						defaultMode: "auto",
					},
				},
			),
		);
		writeFileSync(join(project, ".claude", "settings.local.json"), JSON.stringify(WITH_ENVIRONMENT));
		expect([await get(), await get(`?cwd=${encodeURIComponent(project)}`)]).toStrictEqual([
			{
				status: 200,
				json:
				{
					offered: true,
					setupComplete: false,
					denials: 5,
					dismissed: false,
					snoozedUntil: 0,
					autoModeIsDefault: true,
					sessionHistoryCount: 7,
				},
			},
			{
				status: 200,
				json:
				{
					offered: true,
					setupComplete: true,
					denials: 5,
					dismissed: false,
					snoozedUntil: 0,
					autoModeIsDefault: true,
					sessionHistoryCount: 7,
				},
			},
		]);
	});

	it("fails closed when no file exists, and refuses an unknown folder", async () =>
	{
		expect([await get(), await get("?cwd=%2Fetc")]).toStrictEqual([
			{
				status: 200,
				json:
				{
					...OFF,
					autoModeIsDefault: false,
					sessionHistoryCount: 7,
				},
			},
			{
				status: 400,
				json:
				{
					error: "Expected ?cwd=<a known project folder>",
				},
			},
		]);
	});
});
