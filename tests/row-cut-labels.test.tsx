// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {SessionChat} from "../src/components/session-chat";
import {WorkingMarker} from "../src/components/working-marker";
import {FizzyLakeContext} from "../src/lib/fizzy-lake";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-context", () => ({
	useSettings: () => ({
		settings: {showDebug: true, codeThemeLight: "claude-light", codeThemeDark: "github-dark"},
	}),
}));
vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
	useClaudeEvents: () => ({failedTools: new Map()}),
	useEventStreamConnecting: () => false,
}));

class RecordingObserver {
	static instances: RecordingObserver[] = [];
	observed = new Set<Element>();
	constructor(readonly callback: ResizeObserverCallback) {
		RecordingObserver.instances.push(this);
	}
	observe(target: Element) {
		this.observed.add(target);
	}
	unobserve(target: Element) {
		this.observed.delete(target);
	}
	disconnect() {}
}

/** Make every observed element overflow and fire each observer once. */
function overflowEverything() {
	act(() => {
		for (const observer of RecordingObserver.instances) {
			const targets = [...observer.observed];
			for (const target of targets) {
				Object.defineProperty(target, "scrollWidth", {configurable: true, value: 500});
				Object.defineProperty(target, "clientWidth", {configurable: true, value: 100});
			}
			// Other transcript observers read box sizes these bare entries lack; only the row-cut one matters here.
			try {
				observer.callback(
					targets.map((target) => ({target}) as ResizeObserverEntry),
					observer,
				);
			} catch {
				// Not the row-cut observer.
			}
		}
	});
}

beforeEach(() => {
	RecordingObserver.instances = [];
	vi.stubGlobal("ResizeObserver", class extends RecordingObserver {});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function bashRun(ids: string[]): unknown[] {
	return ids.flatMap((id) => [
		{
			type: "assistant",
			uuid: `a-${id}`,
			message: {
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id,
						name: "Bash",
						input: {command: `echo ${"long ".repeat(40)}`, description: ""},
					},
				],
			},
		},
		{
			type: "user",
			uuid: `r-${id}`,
			parentUuid: `a-${id}`,
			message: {role: "user", content: [{type: "tool_result", tool_use_id: id, content: "ok", is_error: false}]},
		},
	]);
}

function renderChat(records: unknown[], parts?: readonly ("color" | "panels" | "type")[]) {
	const {lines, toolResultMap} = processTranscript(records);
	const chat = (
		<SessionChat
			sessionId="test-session"
			lines={lines}
			toolResultMap={toolResultMap}
			showCompactSummaries
			showTranscriptOnly
		/>
	);
	return render(
		parts === undefined ? chat : <FizzyLakeContext.Provider value={parts}>{chat}</FizzyLakeContext.Provider>,
	);
}

/** The element's text without ShimmerText's aria-hidden clone. */
function visibleText(node: Element): string {
	const copy = node.cloneNode(true) as Element;
	for (const clone of copy.querySelectorAll("[data-cds-shimmer-clone]")) clone.remove();
	return copy.textContent;
}

/** Each row-cut element: its tag, its text, and whether its nearest row carries data-cds-row. */
function cutLabels(container: Element): {tag: string; text: string; inRow: boolean}[] {
	return [...container.querySelectorAll("[data-cds-row-cut]")].map((node) => ({
		tag: node.tagName.toLowerCase(),
		text: visibleText(node),
		inRow: node.closest("[data-cds-row]") !== null,
	}));
}

describe("transcript status labels fade under fizzy-lake type (cds-type-experiment-gate T2)", () => {
	it("fades the collapsed group header label inside a cds row", () => {
		const {container} = renderChat(bashRun(["t1", "t2"]));
		overflowEverything();
		expect(cutLabels(container)).toStrictEqual([{tag: "span", text: "Ran 2 commands", inRow: true}]);
	});

	it("fades a standalone tool row's label and meta inside a cds row", () => {
		const {container} = renderChat(bashRun(["t1"]));
		overflowEverything();
		const cuts = cutLabels(container);
		expect({
			count: cuts.length > 0,
			allInRow: cuts.every((cut) => cut.inRow),
			hasCommand: cuts.some((cut) => cut.text.includes("echo long")),
		}).toStrictEqual({count: true, allInRow: true, hasCommand: true});
	});

	it("leaves labels alone when type is off", () => {
		const {container} = renderChat(bashRun(["t1", "t2"]), ["color", "panels"]);
		overflowEverything();
		expect(cutLabels(container)).toStrictEqual([]);
	});

	it("fades the working line's phase word", () => {
		const {container} = render(<WorkingMarker state={{status: "idle"} as never} sending />);
		overflowEverything();
		expect(cutLabels(container).map((cut) => cut.text)).toStrictEqual(["Sending"]);
	});
});
