// @vitest-environment jsdom

import {readdirSync, readFileSync} from "node:fs";
import {describe, expect, it} from "vite-plus/test";

import {Route as RootRoute} from "../src/routes/__root";
import {Route as SessionRoute} from "../src/routes/session.$id";
import {Route as IndexRoute} from "../src/routes/index";
import {Route as PlansRoute} from "../src/routes/plans";
import {Route as ProjectRoute} from "../src/routes/project.$id";
import {Route as ArtifactsRoute} from "../src/routes/artifacts";
import {Route as ActiveRoute} from "../src/routes/active";
import {resolvedPageTitle} from "../src/lib/route-title";

type Head = (args: {loaderData?: unknown; params?: unknown}) =>
{
	meta?: ReadonlyArray<unknown>;
};

function headOf(
	route:
	{
		options:
		{
			head?: unknown;
		};
	},
	args:
	{
		loaderData?: unknown;
		params?: unknown;
	} = {},
)
{
	return {
		meta: (route.options.head as Head)(args).meta,
	};
}

/** The `<title>` HeadContent writes: the innermost match's title, root last. */
function documentTitle(
	route:
	{
		options:
		{
			head?: unknown;
		};
	},
	args?:
	{
		loaderData?: unknown;
		params?: unknown;
	},
)
{
	const matches = [headOf(RootRoute), headOf(route, args)];
	for (const {meta} of matches.toReversed())
	{
		for (const tag of [...(meta ?? [])].toReversed())
		{
			if (typeof tag === "object" && tag !== null && "title" in tag) return tag.title;
		}
	}
	return null;
}

describe("route head titles", () =>
{
	it("titles every tab 'Claude Code' as upstream does, Artifacts 'Artifacts - Claude'", () =>
	{
		expect(
			{
				session: documentTitle(
					SessionRoute,
					{
						loaderData:
						{
							title: "daily",
						},
					},
				),
				loadingSession: documentTitle(
					SessionRoute,
					{
						loaderData: undefined,
					},
				),
				missingSession: documentTitle(
					SessionRoute,
					{
						loaderData: null,
					},
				),
				home: documentTitle(IndexRoute),
				plans: documentTitle(PlansRoute),
				project: documentTitle(
					ProjectRoute,
					{
						loaderData:
						{
							name: "claude-code-plans",
						},
					},
				),
				active: documentTitle(ActiveRoute),
				artifacts: documentTitle(ArtifactsRoute),
			},
		).toStrictEqual(
			{
				session: "Claude Code",
				loadingSession: "Claude Code",
				missingSession: "Claude Code",
				home: "Claude Code",
				plans: "Claude Code",
				project: "Claude Code",
				active: "Claude Code",
				artifacts: "Artifacts - Claude",
			},
		);
	});

	it("keeps each page's own name as its page title for recents and identity checks", () =>
	{
		expect(
			{
				session: resolvedPageTitle([
					headOf(RootRoute),
					headOf(
						SessionRoute,
						{
							loaderData:
							{
								title: "daily",
							},
						},
					),
				]),
				missingSession: resolvedPageTitle([
					headOf(RootRoute),
					headOf(
						SessionRoute,
						{
							loaderData: null,
						},
					),
				]),
				project: resolvedPageTitle([
					headOf(
						ProjectRoute,
						{
							loaderData:
							{
								name: "claude-code-plans",
							},
						},
					),
				]),
				root: resolvedPageTitle([headOf(RootRoute)]),
			},
		).toStrictEqual(
			{
				session: "daily",
				missingSession: "Session Not Found",
				project: "claude-code-plans",
				root: null,
			},
		);
	});

	it("declares a <title> only in the root route and Artifacts", () =>
	{
		const titled = readdirSync(
			"src/routes",
			{
				recursive: true,
				encoding: "utf8",
			},
		)
			.filter((file) => /\.tsx?$/.test(file))
			.filter((file) => /meta:\s*\[[^\]]*\{\s*title:/.test(readFileSync(`src/routes/${file}`, "utf8")))
			.toSorted();
		expect(titled).toStrictEqual(["__root.tsx", "artifacts.tsx"]);
	});
});
