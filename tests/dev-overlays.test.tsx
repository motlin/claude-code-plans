// @vitest-environment jsdom

import {act, cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {DevOverlays} from "../src/components/dev-overlays";

vi.mock("@tanstack/react-query-devtools", () => ({ReactQueryDevtools: () => <div data-testid="query-devtools" />}));
vi.mock("agentation", () => ({
	Agentation: ({endpoint}: {endpoint?: string}) => <div data-testid="agentation" data-endpoint={endpoint ?? ""} />,
}));

function stubViewport(width: number) {
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: query === "(width < 40rem)" ? width < 640 : false,
		media: query,
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
	}));
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("DevOverlays", () => {
	const mounted = () => ({
		queryDevtools: screen.queryByTestId("query-devtools") !== null,
		agentation: screen.queryByTestId("agentation") !== null,
	});

	it("mounts the query devtools and Agentation toolbar on a wide viewport", () => {
		stubViewport(1280);
		render(<DevOverlays />);
		expect(mounted()).toStrictEqual({queryDevtools: true, agentation: true});
	});

	it("leaves the toolbar endpoint-less, so it never starts its 10s health poll, when no Agentation server answers", async () => {
		stubViewport(1280);
		const fetchMock = vi.fn<typeof fetch>(async () => Promise.resolve(new Response("Bad Gateway", {status: 502})));
		vi.stubGlobal("fetch", fetchMock);
		render(<DevOverlays />);
		await act(async () => {
			await Promise.resolve();
		});
		expect({
			endpoint: screen.getByTestId("agentation").dataset["endpoint"],
			probes: fetchMock.mock.calls,
		}).toStrictEqual({endpoint: "", probes: [["http://localhost:4747/health"]]});
	});

	it("passes the endpoint to the toolbar once the Agentation server answers", async () => {
		stubViewport(1280);
		vi.stubGlobal("fetch", async () => Promise.resolve(new Response("ok", {status: 200})));
		render(<DevOverlays />);
		expect(await screen.findByTestId("agentation")).toHaveProperty("dataset.endpoint", "http://localhost:4747");
	});

	it("keeps both floating dev buttons off a phone, where they would cover the composer's + and send", () => {
		stubViewport(386);
		render(<DevOverlays />);
		expect(mounted()).toStrictEqual({queryDevtools: false, agentation: false});
	});
});
