// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {DevOverlays} from "../src/components/dev-overlays";

vi.mock("@tanstack/react-query-devtools", () => ({ReactQueryDevtools: () => <div data-testid="query-devtools" />}));
vi.mock("agentation", () => ({Agentation: () => <div data-testid="agentation" />}));

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

	it("keeps both floating dev buttons off a phone, where they would cover the composer's + and send", () => {
		stubViewport(386);
		render(<DevOverlays />);
		expect(mounted()).toStrictEqual({queryDevtools: false, agentation: false});
	});
});
