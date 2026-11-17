import {describe, expect, it} from "vite-plus/test";

import {codeSurfaceStyle} from "../src/components/panes/code-surface";
import {PaneKindSchema} from "../src/lib/pane-layout";

const CODE_SURFACE =
{
	background:
		"light-dark(var(--code-theme-light-bg, var(--upstream-surface-2)), var(--code-theme-dark-bg, var(--upstream-surface-2)))",
	"--epitaxy-transcript-surface": "var(--code-theme-bg)",
};

describe("codeSurfaceStyle", () =>
{
	it("paints upstream's code-surface tiles (file, diff, terminal) on the code theme and publishes it as the transcript surface", () =>
	{
		expect(
			Object.fromEntries(PaneKindSchema.options.map((kind) => [kind, codeSurfaceStyle(kind) ?? null])),
		).toStrictEqual(
			{
				files: CODE_SURFACE,
				links: null,
				changes: CODE_SURFACE,
				terminal: CODE_SURFACE,
				"background-tasks": null,
				plan: null,
				artifacts: null,
				subagents: null,
				"side-chat": null,
				"session-details": null,
			},
		);
	});
});
