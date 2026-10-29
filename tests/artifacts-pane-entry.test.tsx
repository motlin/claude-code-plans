// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {useRegisterArtifactsPane, useSessionArtifacts} from "../src/components/panes/artifacts-pane-entry";
import {usePaneDefinitions} from "../src/components/panes/pane-registry";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

/** Like the session page: registers the pane and re-renders whenever the registry publishes. */
function SessionLike({sessionId}: {sessionId: string}) {
	useRegisterArtifactsPane(useSessionArtifacts(sessionId));
	const definitions = usePaneDefinitions();
	return <p>{[...definitions.keys()].join(",")}</p>;
}

describe("useRegisterArtifactsPane with useSessionArtifacts", () => {
	it("registers once while the artifacts query is still loading, without a maximum-update-depth loop", () => {
		vi.stubGlobal("fetch", async () => new Promise<Response>(() => {}));
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		render(
			<QueryClientProvider client={new QueryClient()}>
				<SessionLike sessionId="session-fabricated" />
			</QueryClientProvider>,
		);

		expect(screen.getByText("artifacts").textContent).toStrictEqual("artifacts");
		expect(consoleError.mock.calls).toStrictEqual([]);
		consoleError.mockRestore();
	});
});
