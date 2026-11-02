import {mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {Route as PlanDetailRoute} from "../src/routes/api/plans.$filename";
import {Route as MemoryDetailRoute} from "../src/routes/api/projects.$id.memories.$filename";
import {Route as SettingsRoute} from "../src/routes/api/settings";
import {Route as SourceRoute} from "../src/routes/api/source.$kind.$";

const mockedHome = vi.hoisted(() => (
{
	path: "",
}));

vi.mock("node:os", async () => (
{
	...(await vi.importActual<typeof import("node:os")>("node:os")),
	homedir: () => mockedHome.path,
}));

interface DetailRouteContext
{
	params:
	{
		filename: string;
		id?: string;
	};
	request: Request;
}

type DetailRouteHandler = (context: DetailRouteContext) => Promise<Response>;

function getDetailRouteHandler(route: unknown): DetailRouteHandler
{
	return (
		route as
		{
			options:
			{
				server:
				{
					handlers:
					{
						GET: DetailRouteHandler;
					};
				};
			};
		}
	).options.server.handlers.GET;
}

let fixtureDirectory: string;

beforeEach(() =>
{
	fixtureDirectory = mkdtempSync(join(tmpdir(), "md-route-containment-test-"));
	mockedHome.path = fixtureDirectory;
	mkdirSync(
		join(fixtureDirectory, ".claude", "plans"),
		{
			recursive: true,
		},
	);
	mkdirSync(
		join(fixtureDirectory, ".claude", "projects", "alice-project", "memory"),
		{
			recursive: true,
		},
	);
	writeFileSync(join(fixtureDirectory, ".claude", "CLAUDE.md"), "# Fabricated instructions\n");
});

afterEach(() =>
{
	rmSync(
		fixtureDirectory,
		{
			recursive: true,
			force: true,
		},
	);
});

const futureIfModifiedSince = "Fri, 31 Dec 9999 23:59:59 GMT";

async function describeTraversalResponse(response: Response): Promise<
{
	body: string;
	lastModified: string | null;
	status: number;
}>
{
	return {
		body: await response.text(),
		lastModified: response.headers.get("Last-Modified"),
		status: response.status,
	};
}

/** Writes `content` and pins its mtime to `mtimeMs`, so two edits can share one wall-clock second. */
function writeAt(filePath: string, content: string, mtimeMs: number): void
{
	writeFileSync(filePath, content);
	utimesSync(filePath, new Date(mtimeMs), new Date(mtimeMs));
}

const firstSave = Date.parse("2026-05-14T12:00:00.200Z");
const secondSave = Date.parse("2026-05-14T12:00:00.800Z");

/** Revalidates the way a browser does, echoing every validator the first response carried. */
function revalidationHeaders(first: Response): Record<string, string>
{
	const headers: Record<string, string> = {};
	const etag = first.headers.get("ETag");
	if (etag !== null) headers["If-None-Match"] = etag;
	const lastModified = first.headers.get("Last-Modified");
	if (lastModified !== null) headers["If-Modified-Since"] = lastModified;
	return headers;
}

interface ConditionalCase
{
	name: string;
	route: unknown;
	params:
	{
		filename: string;
		id?: string;
		kind?: string;
		_splat?: string;
	};
	url: string;
	filePath: () => string;
}

const conditionalCases: ConditionalCase[] = [
	{
		name: "plan",
		route: PlanDetailRoute,
		params:
		{
			filename: "alpha",
		},
		url: "https://example.com/api/plans/alpha",
		filePath: () => join(fixtureDirectory, ".claude", "plans", "alpha.md"),
	},
	{
		name: "memory",
		route: MemoryDetailRoute,
		params:
		{
			filename: "notes",
			id: "alice-project",
		},
		url: "https://example.com/api/projects/alice-project/memories/notes",
		filePath: () => join(fixtureDirectory, ".claude", "projects", "alice-project", "memory", "notes.md"),
	},
	{
		name: "source",
		route: SourceRoute,
		params:
		{
			filename: "",
			kind: "plan",
			_splat: "alpha.md",
		},
		url: "https://example.com/api/source/plan/alpha.md",
		filePath: () => join(fixtureDirectory, ".claude", "plans", "alpha.md"),
	},
];

describe("conditional GET validators", () =>
{
	for (const testCase of conditionalCases)
	{
		const handler = async (headers: Record<string, string>): Promise<Response> =>
			(getDetailRouteHandler(testCase.route) as (context: unknown) => Promise<Response>)(
				{
					params: testCase.params,
					request: new Request(
						testCase.url,
						{
							headers,
						},
					),
				},
			);

		it(`serves the ${testCase.name} again after a second save within the same second`, async () =>
		{
			writeAt(testCase.filePath(), "# First\n", firstSave);
			const first = await handler({});
			writeAt(testCase.filePath(), "# Second\n", secondSave);

			const second = await handler(revalidationHeaders(first));

			expect(
				{
					status: second.status,
					mentionsSecond: (await second.text()).includes("# Second"),
				},
			).toStrictEqual(
				{
					status: 200,
					mentionsSecond: true,
				},
			);
		});

		it(`answers an unchanged ${testCase.name} with 304 and its ETag`, async () =>
		{
			writeAt(testCase.filePath(), "# First\n", firstSave);
			const first = await handler({});
			const etag = first.headers.get("ETag");

			const second = await handler(revalidationHeaders(first));

			expect(
				{
					status: second.status,
					etag: second.headers.get("ETag"),
					body: await second.text(),
				},
			).toStrictEqual(
				{
					status: 304,
					etag: `"${statSync(testCase.filePath()).mtimeMs}-${"# First\n".length}"`,
					body: "",
				},
			);
			expect(etag).toBe(second.headers.get("ETag"));
		});
	}

	describe("settings", () =>
	{
		const settingsHandler = async (headers: Record<string, string>): Promise<Response> =>
			(getDetailRouteHandler(SettingsRoute) as (context: unknown) => Promise<Response>)(
				{
					request: new Request(
						"https://example.com/api/settings",
						{
							headers,
						},
					),
				},
			);
		const settingsPath = (): string => join(fixtureDirectory, ".claude", "settings.json");
		const localPath = (): string => join(fixtureDirectory, ".claude", "settings.local.json");

		it("changes the validator when settings.local.json is deleted", async () =>
		{
			writeAt(settingsPath(), '{"model":"opus"}', secondSave);
			writeAt(localPath(), '{"model":"sonnet"}', firstSave);
			const first = await settingsHandler({});
			rmSync(localPath());

			const second = await settingsHandler(revalidationHeaders(first));

			expect(second.status).toBe(200);
		});

		it("serves settings again after a same-second edit to either file", async () =>
		{
			writeAt(settingsPath(), '{"model":"opus"}', firstSave);
			const first = await settingsHandler({});
			writeAt(settingsPath(), '{"model":"haiku"}', secondSave);

			const second = await settingsHandler(revalidationHeaders(first));

			expect(second.status).toBe(200);
		});

		it("answers unchanged settings with 304", async () =>
		{
			writeAt(settingsPath(), '{"model":"opus"}', firstSave);
			const first = await settingsHandler({});

			const second = await settingsHandler(revalidationHeaders(first));

			expect(
				{
					status: second.status,
					etag: second.headers.get("ETag"),
				},
			).toStrictEqual(
				{
					status: 304,
					etag: `"${statSync(settingsPath()).mtimeMs}-16_absent"`,
				},
			);
		});
	});
});

describe("markdown detail route containment", () =>
{
	it("returns 404 without exposing plan metadata for a traversal filename", async () =>
	{
		const response = await getDetailRouteHandler(PlanDetailRoute)(
			{
				params:
				{
					filename: "../CLAUDE",
				},
				request: new Request(
					"https://example.com/api/plans/..%2FCLAUDE",
					{
						headers:
						{
							"If-Modified-Since": futureIfModifiedSince,
						},
					},
				),
			},
		);

		expect(await describeTraversalResponse(response)).toStrictEqual(
			{
				body: "Not Found",
				lastModified: null,
				status: 404,
			},
		);
	});

	it("returns 404 without exposing memory metadata for a traversal filename", async () =>
	{
		const response = await getDetailRouteHandler(MemoryDetailRoute)(
			{
				params:
				{
					filename: "../../../CLAUDE",
					id: "alice-project",
				},
				request: new Request(
					"https://example.com/api/projects/alice-project/memories/..%2F..%2F..%2FCLAUDE",
					{
						headers:
						{
							"If-Modified-Since": futureIfModifiedSince,
						},
					},
				),
			},
		);

		expect(await describeTraversalResponse(response)).toStrictEqual(
			{
				body: "Not Found",
				lastModified: null,
				status: 404,
			},
		);
	});
});
