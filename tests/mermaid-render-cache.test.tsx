// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {MermaidDiagram} from "../src/components/mermaid-diagram";
import {
	cachedDiagram,
	drawnKey,
	rememberDrawn,
	rememberRefusal,
	loadMermaidWithGuard,
	loadMermaidGuard,
	resetMermaidCachesForTests,
} from "../src/lib/mermaid-render";
import {guardedRender} from "./helpers/mermaid-sandbox";

const {renderDiagram} = vi.hoisted(() => ({
	renderDiagram: vi.fn<(id: string, code: string, host: HTMLElement) => Promise<{svg: string}>>(),
}));

vi.mock("mermaid", () => ({default: {initialize: vi.fn<(config: unknown) => void>(), render: renderDiagram}}));

async function settle() {
	for (let i = 0; i < 20; i++) {
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
	}
}

// The guard and mermaid load through dynamic imports, which the fake clock cannot hurry.
beforeAll(async () => {
	await Promise.all([loadMermaidGuard(), loadMermaidWithGuard()]);
});

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("innerWidth", 1000);
	resetMermaidCachesForTests();
	renderDiagram.mockReset();
	renderDiagram.mockImplementation(
		guardedRender((id) => `<svg id="${id}"><style>#${id} .node{fill:red}</style></svg>`),
	);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

/** Mount, let it draw, unmount (which caches it), and report the statuses of a second mount. */
async function remount(first: {mode: "light" | "dark"; code: string}, second: {mode: "light" | "dark"; code: string}) {
	const view = render(<MermaidDiagram {...first} />);
	await settle();
	view.unmount();
	renderDiagram.mockClear();
	const statuses: string[] = [];
	const again = render(<MermaidDiagram {...second} onStatusChange={(status) => statuses.push(status)} />);
	return {statuses, again, renders: renderDiagram.mock.calls.length};
}

describe("drawn-diagram cache (upstream yL/cy/B1)", () => {
	it("remounts a drawn diagram as a success at once, without drawing", async () => {
		const {statuses, again, renders} = await remount(
			{mode: "light", code: "graph TD; A-->B"},
			{mode: "light", code: "graph TD; A-->B"},
		);
		const svg = again.container.firstElementChild?.shadowRoot?.lastElementChild?.firstElementChild;
		expect({statuses, renders, scoped: svg?.id.endsWith("-c")}).toStrictEqual({
			statuses: ["success"],
			renders: 0,
			scoped: true,
		});
	});

	it("redraws for another mode", async () => {
		const {statuses} = await remount({mode: "light", code: "graph TD"}, {mode: "dark", code: "graph TD"});
		await settle();
		expect({statuses, renders: renderDiagram.mock.calls.length}).toStrictEqual({
			statuses: ["loading", "success"],
			renders: 1,
		});
	});

	it("misses once the window is more than 120px wider or narrower", () => {
		const key = drawnKey("light", "graph TD");
		rememberDrawn(key, {svg: '<svg id="mermaid-r1"></svg>', scopeId: "mermaid-r1", width: 1000});
		vi.stubGlobal("innerWidth", 1120);
		const at120 = cachedDiagram(key, "mermaid-r2-c");
		vi.stubGlobal("innerWidth", 1121);
		const at121 = cachedDiagram(key, "mermaid-r2-c");
		expect({at120, at121}).toStrictEqual({
			at120: {svg: '<svg id="mermaid-r2-c"></svg>', scopeId: "mermaid-r2-c", width: 1000},
			at121: undefined,
		});
	});

	it("keeps 48 entries, evicting the oldest, and skips SVGs over 512000 chars", () => {
		for (let index = 0; index < 49; index++)
			rememberDrawn(drawnKey("light", `graph ${index}`), {svg: "<svg></svg>", scopeId: "s", width: 1000});
		rememberDrawn(drawnKey("light", "huge"), {svg: "x".repeat(512_001), scopeId: "s", width: 1000});
		rememberDrawn(drawnKey("light", "edge"), {svg: "x".repeat(512_000), scopeId: "s", width: 1000});
		const hit = (code: string) => cachedDiagram(drawnKey("light", code), "t") !== undefined;
		expect(["graph 0", "graph 1", "graph 2", "graph 48", "huge", "edge"].map(hit)).toStrictEqual([
			false,
			false,
			true,
			true,
			false,
			true,
		]);
	});
});

describe("refusal cache (upstream Pw/vR)", () => {
	it("shows a refused source as an error on mount without drawing it", async () => {
		rememberRefusal("graph TD; refused", "measure");
		const statuses: string[] = [];
		const {container} = render(
			<MermaidDiagram mode="light" code="graph TD; refused" onStatusChange={(status) => statuses.push(status)} />,
		);
		await settle();
		expect({
			statuses,
			renders: renderDiagram.mock.calls.length,
			tag: container.firstElementChild?.localName,
		}).toStrictEqual({statuses: ["error"], renders: 0, tag: "pre"});
	});
});
