// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {DiffStats} from "../src/components/tool-renderers/shared";
import {SessionChat} from "../src/components/session-chat";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-context", () => ({
	useSettings: () => ({settings: {showDebug: false, verbosity: "compact"}}),
}));
vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
	useClaudeEvents: () => ({failedTools: new Map()}),
}));

afterEach(cleanup);

/**
 * Upstream claude.ai/code renders the stats cluster as
 * `span.inline-flex > span.flex.gap-g1.items-center.text-body.tabular-nums.shrink-0`
 * with green additions and pink removals.
 */
const CLUSTER_CLASS = "flex gap-g1 items-center text-body tabular-nums shrink-0";

interface StatsMarkup {
	wrapperClass: string;
	clusterClass: string;
	parts: {className: string; text: string}[];
}

function statsMarkup(container: HTMLElement): StatsMarkup {
	const wrapper = container.firstElementChild as HTMLElement | null;
	if (!wrapper) throw new Error("no diff stats rendered");
	const cluster = wrapper.firstElementChild as HTMLElement | null;
	if (!cluster) throw new Error("diff stats has no inner cluster");
	return {
		wrapperClass: wrapper.className,
		clusterClass: cluster.className,
		parts: [...cluster.children].map((child) => ({
			className: (child as HTMLElement).className,
			text: child.textContent,
		})),
	};
}

describe("DiffStats", () => {
	it("renders the upstream cluster markup", () => {
		const {container} = render(<DiffStats added={15} removed={3} />);

		expect(statsMarkup(container)).toStrictEqual({
			wrapperClass: "inline-flex",
			clusterClass: CLUSTER_CLASS,
			parts: [
				{className: "text-diff-added", text: "+15"},
				{className: "text-diff-removed", text: "−3"},
			],
		});
	});

	it('keeps a zero removed count, as upstream reads a created file "+42 −0"', () => {
		const {container} = render(<DiffStats added={42} removed={0} />);

		expect(statsMarkup(container).parts).toStrictEqual([
			{className: "text-diff-added", text: "+42"},
			{className: "text-diff-removed", text: "−0"},
		]);
	});

	it("renders nothing when there is no change", () => {
		const {container} = render(<DiffStats added={0} removed={0} />);

		expect(container.innerHTML).toBe("");
	});
});

const EDIT_RECORD = {
	type: "assistant",
	uuid: "edit-1",
	timestamp: "2026-08-12T00:00:00.000Z",
	message: {
		role: "assistant",
		content: [
			{
				type: "tool_use",
				id: "toolu_edit_1",
				name: "Edit",
				input: {
					file_path: "/tmp/example.ts",
					old_string: "const a = 1;\nconst b = 2;\n",
					new_string: "const a = 1;\nconst b = 3;\nconst c = 4;\n",
				},
			},
		],
	},
};

describe("Edit tool row stats", () => {
	it("draws upstream's tabular-nums stat pill on the row, as in an edit group", () => {
		const {lines, toolResultMap} = processTranscript([EDIT_RECORD]);
		const html = renderToStaticMarkup(
			<SessionChat
				sessionId="test-session"
				lines={lines}
				toolResultMap={toolResultMap}
				showCompactSummaries
				showTranscriptOnly
			/>,
		);

		expect(html).toContain(
			'<span data-diff-stat-pill="" class="ms-1 inline-flex h-[1lh] shrink-0 items-center text-ink-muted tabular-nums">',
		);
		expect(html).toContain('<span class="sr-only">2 added, 1 removed</span>');
	});
});
