import {afterEach, describe, expect, it} from "vite-plus/test";
import type {FastModeBlockDependencies} from "../src/lib/composer-state-server";
import {withShellChinLabels} from "../src/lib/shell-chin-labels";
import {getShellChinLabels, setShellChinLabels} from "../src/lib/shell-chin-store";

const settings =
{
	model: "opus",
	effortLevel: "medium",
	permissions:
	{
		defaultMode: "auto",
	},
};

async function labelsAfter(
	url: string,
	method = "GET",
	readSettings: () => Promise<unknown> = async () => Promise.resolve(settings),
	blockDependencies: FastModeBlockDependencies = {},
)
{
	let seen: ReturnType<typeof getShellChinLabels> = null;
	const fetch = withShellChinLabels(
		() =>
		{
			seen = getShellChinLabels();
			return new Response("ok");
		},
		readSettings,
		async () => Promise.resolve(blockDependencies),
	);
	await fetch(
		new Request(
			url,
			{
				method,
			},
		),
	);
	return seen;
}

describe("withShellChinLabels", () =>
{
	afterEach(() =>
	{
		setShellChinLabels(null);
	});

	it("reads settings.json before a page render so the shell paints its chin labels", async () =>
	{
		expect(await labelsAfter("http://localhost/session/abc")).toStrictEqual(
			{
				mode: "Auto",
				model: "Opus 5.5",
				effort: "Medium",
			},
		);
	});

	it("names the CLI's no-flag start mode, from its cached rollout gate, when settings.json sets no mode", async () =>
	{
		const noMode = async () =>
			Promise.resolve(
				{
					model: "opus",
				},
			);
		const config = (willow: boolean) => (
		{
			readCliConfig: async () =>
				Promise.resolve(
					{
						cachedGrowthBookFeatures:
						{
							tengu_harbor_willow: willow,
						},
					},
				),
		});
		expect([
			await labelsAfter("http://localhost/", "GET", noMode, config(true)),
			await labelsAfter("http://localhost/", "GET", noMode, config(false)),
		]).toStrictEqual([
			{
				mode: "Auto",
				model: "Opus 5.5",
				effort: "Medium",
			},
			{
				mode: "Manual",
				model: "Opus 5.5",
				effort: "Medium",
			},
		]);
	});

	it("skips API requests, which never render the shell", async () =>
	{
		expect([
			await labelsAfter("http://localhost/api/sessions"),
			await labelsAfter("http://localhost/", "POST"),
		]).toStrictEqual([null, null]);
	});
});
