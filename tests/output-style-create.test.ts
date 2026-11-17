import {mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import
{
	createOutputStyle,
	handleOutputStyleCreate,
	handleOutputStyleValidate,
	outputStyleSlug,
	validateOutputStyleName,
} from "../src/lib/output-style-create";

const TERSE_DRAFT = `---
name: Terse
description: Short answers first.
---

Answer in one sentence, then add detail only when asked.
`;

describe("validateOutputStyleName", () =>
{
	it("accepts plain words and refuses taken, reserved or odd names", () =>
	{
		expect(
			{
				ok: validateOutputStyleName("Terse", ["Default", "Explanatory"]),
				exists: validateOutputStyleName("learning", ["Learning"]),
				reserved: validateOutputStyleName("default", []),
				traversal: validateOutputStyleName("../x", []),
				blank: validateOutputStyleName("", []),
			},
		).toStrictEqual(
			{
				ok: "ok",
				exists: "exists",
				reserved: "invalid",
				traversal: "invalid",
				blank: "invalid",
			},
		);
	});

	it("slugs a name to its file name", () =>
	{
		expect(outputStyleSlug("Short  And Sweet")).toStrictEqual("short-and-sweet");
	});
});

describe("createOutputStyle", () =>
{
	let claudeDir: string;

	beforeEach(async () =>
	{
		claudeDir = await realpath(await mkdtemp(join(tmpdir(), "output-style-create-")));
	});

	afterEach(async () =>
	{
		await rm(
			claudeDir,
			{
				recursive: true,
				force: true,
			},
		);
	});

	const neverAborted = () => new AbortController().signal;

	it("writes the drafted style under output-styles and reports it created, not refreshed", async () =>
	{
		const prompts: string[] = [];
		const result = await createOutputStyle(
			{
				claudeDir,
				description: "Short answers first",
				signal: neverAborted(),
				draft: async (prompt) =>
				{
					prompts.push(prompt);
					return Promise.resolve(TERSE_DRAFT);
				},
			},
		);
		const path = join(claudeDir, "output-styles", "terse.md");
		expect(
			{
				result,
				file: await readFile(path, "utf-8"),
				asked: prompts.length,
			},
		).toStrictEqual(
			{
				result:
				{
					outcome: "created",
					name: "Terse",
					path,
					refreshed: false,
					selected: false,
				},
				file: `---
name: Terse
description: "Short answers first."
---

Answer in one sentence, then add detail only when asked.
`,
				asked: 1,
			},
		);
	});

	it("uses a given name verbatim and suffixes an unnamed draft's name on collision", async () =>
	{
		await mkdir(join(claudeDir, "output-styles"));
		await writeFile(join(claudeDir, "output-styles", "terse.md"), TERSE_DRAFT);
		const named = await createOutputStyle(
			{
				claudeDir,
				description: "Short answers first",
				name: "Crisp",
				signal: neverAborted(),
				draft: async () => Promise.resolve(TERSE_DRAFT),
			},
		);
		const unnamed = await createOutputStyle(
			{
				claudeDir,
				description: "Short answers first",
				signal: neverAborted(),
				draft: async () => Promise.resolve(TERSE_DRAFT),
			},
		);
		expect(
			{
				named: named.outcome === "created" ? named.name : named.outcome,
				unnamed: unnamed.outcome === "created" ? unnamed.name : unnamed.outcome,
				crisp: (await readFile(join(claudeDir, "output-styles", "crisp.md"), "utf-8")).split("\n", 2)[1],
				files: (await readdir(join(claudeDir, "output-styles"))).toSorted(),
			},
		).toStrictEqual(
			{
				named: "Crisp",
				unnamed: "Terse 2",
				crisp: "name: Crisp",
				files: ["crisp.md", "terse-2.md", "terse.md"],
			},
		);
	});

	it("maps a failed draft, a taken or bad name, a busy runner and a cancel to upstream's outcomes", async () =>
	{
		await mkdir(join(claudeDir, "output-styles"));
		await writeFile(join(claudeDir, "output-styles", "terse.md"), "Answer briefly.\n");
		const create = async (
			name: string | undefined,
			draft: (prompt: string) => Promise<string>,
			signal = neverAborted(),
		) =>
			(
				await createOutputStyle(
					{
						claudeDir,
						description: "Short answers first",
						...(name === undefined
							? {}
							:
								{
									name,
								}),
						signal,
						draft,
					},
				)
			).outcome;
		const failed = await create(undefined, async () => Promise.reject(new Error("claude CLI failed")));
		const exists = await create("Terse", async () => Promise.resolve(TERSE_DRAFT));
		const invalid = await create("../x", async () => Promise.resolve(TERSE_DRAFT));
		let release: (draft: string) => void = () =>
		{
		};
		const slowDraft = new Promise<string>((resolve) =>
		{
			release = resolve;
		});
		const slow = create("Slow", async () => slowDraft);
		const busy = await create("Other", async () => Promise.resolve(TERSE_DRAFT));
		release(TERSE_DRAFT);
		const first = await slow;
		const controller = new AbortController();
		const cancelled = await create(
			"Gone",
			async () =>
			{
				controller.abort();
				return Promise.resolve(TERSE_DRAFT);
			},
			controller.signal,
		);
		expect(
			{
				failed,
				exists,
				invalid,
				busy,
				first,
				cancelled,
				files: (await readdir(join(claudeDir, "output-styles"))).toSorted(),
			},
		).toStrictEqual(
			{
				failed: "draft_failed",
				exists: "name_exists",
				invalid: "name_invalid",
				busy: "busy_creating",
				first: "created",
				cancelled: "cancelled",
				files: ["slow.md", "terse.md"],
			},
		);
	});
});

describe("output style routes", () =>
{
	let claudeDir: string;

	beforeEach(async () =>
	{
		claudeDir = await realpath(await mkdtemp(join(tmpdir(), "output-style-routes-")));
		await mkdir(join(claudeDir, "output-styles"));
		await writeFile(join(claudeDir, "output-styles", "terse.md"), TERSE_DRAFT);
	});

	afterEach(async () =>
	{
		await rm(
			claudeDir,
			{
				recursive: true,
				force: true,
			},
		);
	});

	const post = (path: string, body: unknown) =>
		new Request(
			`http://localhost${path}`,
			{
				method: "POST",
				headers:
				{
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			},
		);

	it("validates a name against the user's styles", async () =>
	{
		const responses = await Promise.all(
			["Crisp", "terse", "explanatory", "a/b"].map(async (name) =>
				(
					await handleOutputStyleValidate(
						post(
							"/api/output-styles/validate",
							{
								name,
							},
						),
						claudeDir,
					)
				).json(),
			),
		);
		expect(responses).toStrictEqual([
			{
				ok: true,
			},
			{
				ok: false,
				reason: "exists",
			},
			{
				ok: false,
				reason: "exists",
			},
			{
				ok: false,
				reason: "invalid",
			},
		]);
	});

	it("creates a style from a description and refuses a blank one", async () =>
	{
		const created = await handleOutputStyleCreate(
			post(
				"/api/output-styles",
				{
					description: "Crisp answers",
					name: "Crisp",
				},
			),
			claudeDir,
			async () => Promise.resolve(TERSE_DRAFT),
		);
		const blank = await handleOutputStyleCreate(
			post(
				"/api/output-styles",
				{
					description: "",
				},
			),
			claudeDir,
			async () => Promise.resolve(TERSE_DRAFT),
		);
		expect(
			{
				created: await created.json(),
				blank: blank.status,
			},
		).toStrictEqual(
			{
				created:
				{
					outcome: "created",
					name: "Crisp",
					path: join(claudeDir, "output-styles", "crisp.md"),
					refreshed: false,
					selected: false,
				},
				blank: 400,
			},
		);
	});
});
