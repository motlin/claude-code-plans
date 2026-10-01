// @vitest-environment jsdom

import {cleanup} from "@testing-library/react";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionChat} from "../src/components/session-chat";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-provider", () => ({
	useSettings: () => ({
		settings: {showDebug: true, codeThemeLight: "claude-light", codeThemeDark: "github-dark"},
	}),
}));
vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
	useClaudeEvents: () => ({failedTools: new Map()}),
}));

afterEach(cleanup);

const PR_URL = "https://github.com/motlin/claude-code-plans/pull/1954";

function prLinkRecord(timestamp: string) {
	return {
		type: "pr-link",
		prUrl: PR_URL,
		prNumber: 1954,
		prRepository: "motlin/claude-code-plans",
		sessionId: "s-1",
		timestamp,
	};
}

const RECORDS = [
	{
		type: "user",
		uuid: "u-1",
		parentUuid: null,
		sessionId: "s-1",
		timestamp: "2026-09-30T10:00:00Z",
		message: {role: "user", content: "Open the pull request"},
	},
	prLinkRecord("2026-09-30T10:01:00Z"),
	prLinkRecord("2026-09-30T10:02:00Z"),
	prLinkRecord("2026-09-30T10:03:00Z"),
];

describe("pr-link records", () => {
	it("render no transcript banner", () => {
		const {lines, toolResultMap} = processTranscript(RECORDS);
		const html = renderToStaticMarkup(
			<SessionChat sessionId="s-1" lines={lines} toolResultMap={toolResultMap} showSystemBanners />,
		);
		expect({
			prompt: html.includes("Open the pull request"),
			prUrl: html.includes(PR_URL),
			prLabel: html.includes("#1954"),
		}).toStrictEqual({prompt: true, prUrl: false, prLabel: false});
	});
});
