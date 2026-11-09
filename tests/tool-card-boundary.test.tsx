// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {Component, type ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {RenderErrorBoundary} from "../src/components/render-error-boundary";
import {ToolCardBoundary, ToolCardCrashed} from "../src/components/tool-card-boundary";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

const CRASHED_HTML =
	'<div class="px-md py-xs text-center" data-testid="tool-card-crashed"><span class="text-body text-secondary">Couldn’t load this.</span></div>';

const BOOM = new Error("boom");

function Thrower({error = BOOM}: {error?: Error}): ReactNode {
	throw error;
}

function Fine() {
	return <span>card body</span>;
}

class Outer extends Component<{children: ReactNode}, {caught: boolean}> {
	override state = {caught: false};
	static getDerivedStateFromError() {
		return {caught: true};
	}
	override render(): ReactNode {
		return this.state.caught ? <p>outer caught</p> : this.props.children;
	}
}

function toolCardLogs(): number {
	return consoleError.mock.calls.filter((args: unknown[]) => args[0] === "[tool-card]").length;
}

describe("ToolCardBoundary", () => {
	it("replaces a crashed card with upstream's tool-card-crashed fallback", () => {
		const {container, getByText, queryByText} = render(
			<div>
				<ToolCardBoundary resetOn="input_settled">
					<Thrower />
				</ToolCardBoundary>
				<span>sibling</span>
			</div>,
		);
		expect(container.querySelector("[data-testid=tool-card-crashed]")?.outerHTML).toEqual(CRASHED_HTML);
		expect(getByText("sibling").textContent).toEqual("sibling");
		expect(queryByText("boom")).toBeNull();
	});

	it("does not retry within the same stage", () => {
		const {container, rerender} = render(
			<ToolCardBoundary resetOn="input_settled">
				<Thrower />
			</ToolCardBoundary>,
		);
		rerender(
			<ToolCardBoundary resetOn="input_settled">
				<Fine />
			</ToolCardBoundary>,
		);
		expect(container.innerHTML).toEqual(CRASHED_HTML);
	});

	it("retries the card when its stage changes", () => {
		const {container, rerender} = render(
			<ToolCardBoundary resetOn="input_settled">
				<Thrower />
			</ToolCardBoundary>,
		);
		rerender(
			<ToolCardBoundary resetOn="result">
				<Fine />
			</ToolCardBoundary>,
		);
		expect(container.innerHTML).toEqual("<span>card body</span>");
	});

	it("logs once per stage", () => {
		const {rerender} = render(
			<ToolCardBoundary resetOn="input_settled">
				<Thrower />
			</ToolCardBoundary>,
		);
		for (let i = 0; i < 3; i++) {
			rerender(
				<ToolCardBoundary resetOn="input_settled">
					<Thrower />
				</ToolCardBoundary>,
			);
		}
		expect(toolCardLogs()).toEqual(1);
		rerender(
			<ToolCardBoundary resetOn="result">
				<Thrower />
			</ToolCardBoundary>,
		);
		expect(toolCardLogs()).toEqual(2);
	});

	it("keeps a chunk-load error inside the card", () => {
		const chunk = new Error("Failed to fetch dynamically imported module: /assets/x.js");
		chunk.name = "ChunkLoadError";
		const {container, queryByText} = render(
			<Outer>
				<ToolCardBoundary resetOn="input_settled">
					<Thrower error={chunk} />
				</ToolCardBoundary>
			</Outer>,
		);
		expect(container.innerHTML).toEqual(CRASHED_HTML);
		expect(queryByText("outer caught")).toBeNull();
	});

	it("renders nothing once errors keep landing over its fallback", () => {
		// React 19 escalates or replays a fallback that throws during one render pass, so the commits that
		// upstream's `MK` guard counts are driven through the lifecycle directly.
		const props = {resetOn: "input_settled", fallback: <ToolCardCrashed />, report: () => {}, children: null};
		const boundary = new RenderErrorBoundary(props);
		boundary.setState = (update) => {
			boundary.state = {...boundary.state, ...(update as object)};
		};
		boundary.state = {error: new Error("boom"), fallbackFailed: false, resetCount: 0};
		boundary.componentDidMount();
		const landOverFallback = () => {
			const previous = boundary.state;
			boundary.state = {...previous, error: new Error("fallback boom")};
			boundary.componentDidUpdate(props, previous);
		};
		for (let i = 0; i < 3; i++) landOverFallback();
		expect(render(<>{boundary.render()}</>).container.innerHTML).toEqual(CRASHED_HTML);
		landOverFallback();
		expect(boundary.state.fallbackFailed).toEqual(true);
		expect(boundary.render()).toBeNull();
	});
});
