// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {UsageRing} from "../src/components/composer-chin";
import {NextStepsList} from "../src/components/home/start-card";
import {ProjectPicker} from "../src/components/home/project-picker";
import {SessionCostPill} from "../src/components/session-cost-pill";
import {SettingsSearch} from "../src/components/settings/settings-search";
import {preloadPopoverSheet} from "../src/components/ui/popover";

/** A coarse pointer at `width`: upstream's sheet gate `(pointer: coarse) and (max-width: 639.98px)`. */
function stubCoarseAtWidth(width: number) {
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => ({
			matches:
				query === "(pointer: coarse)" ||
				(query === "(pointer: coarse) and (max-width: 639.98px)" && width < 640),
			media: query,
			onchange: null,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		})),
	);
}

function withQueryClient(children: ReactNode) {
	const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function presentation() {
	return {
		dialog: screen.getByRole("dialog").getAttribute("data-presentation"),
		scrim: document.querySelector("[data-sheet-scrim]") !== null,
	};
}

/* The sheet presentation is a lazy chunk; load it once so sheets render synchronously on open. */
beforeAll(async () => {
	await preloadPopoverSheet();
});

beforeEach(() => {
	vi.stubGlobal("fetch", async () => new Promise(() => {}));
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function openUsage() {
	render(withQueryClient(<UsageRing usage={null} />));
	fireEvent.click(document.querySelector("button")!);
}

function openCost() {
	render(
		<SessionCostPill
			cost={{totalCostUSD: 1.5, linesAdded: 3, linesRemoved: 1, hasUnknownModelCost: false, models: []}}
			className="pill"
		>
			$1.50
		</SessionCostPill>,
	);
	fireEvent.click(screen.getByRole("button", {name: "Session cost: $1.50"}));
}

function openNextStep() {
	const candidate = (n: number) => ({
		id: "waiting-session" as const,
		subject: `s${n}`,
		stamp: n,
		title: `Session ${n}`,
		detail: null,
	});
	render(
		<NextStepsList
			rows={[
				{
					type: "rest",
					title: "Claude is blocked in 2 sessions",
					dismissLabel: "Dismiss",
					rest: [candidate(1), candidate(2)],
				},
			]}
			onOpen={() => {}}
			onDismiss={() => {}}
		/>,
	);
	fireEvent.click(screen.getByRole("button", {name: "Claude is blocked in 2 sessions"}));
}

describe("sheet-eligible popovers under a coarse pointer", () => {
	it.each([
		["Usage", openUsage],
		["session cost", openCost],
		["Next step", openNextStep],
	])("the %s popover is a bottom sheet at 420px", (_name, open) => {
		stubCoarseAtWidth(420);
		open();
		expect(presentation()).toStrictEqual({dialog: "sheet", scrim: true});
	});

	it.each([
		["Usage", openUsage],
		["session cost", openCost],
		["Next step", openNextStep],
	])("the %s popover stays anchored at 900px", (_name, open) => {
		stubCoarseAtWidth(900);
		open();
		expect(presentation()).toStrictEqual({dialog: null, scrim: false});
	});

	it("moves the Usage popover's sizing onto the sheet body wrapper, keeping its padding-less body", () => {
		stubCoarseAtWidth(420);
		openUsage();
		const popup = screen.getByRole("dialog");
		const wrapper = popup.querySelector("[data-cds-popover-body]")?.parentElement;
		expect({
			popupHasWidth: popup.className.includes("w-[360px]"),
			wrapperHasWidth: wrapper?.className.includes("w-[360px]"),
			wrapperFullWidth: wrapper?.className.split(" ").includes("w-full"),
			close: screen.getByRole("button", {name: "Close"}).hasAttribute("data-cds-sheet-control"),
		}).toStrictEqual({popupHasWidth: false, wrapperHasWidth: false, wrapperFullWidth: true, close: true});
	});
});

describe("anchored-upstream popovers under a coarse pointer at 420px", () => {
	it("keeps the project picker anchored, like upstream's Add repository combobox", () => {
		stubCoarseAtWidth(420);
		render(
			<ProjectPicker
				projects={[{id: "p", name: "p", projectPath: "/p"}]}
				selected={undefined}
				onSelect={() => {}}
			/>,
		);
		fireEvent.click(screen.getByRole("combobox", {name: "Select project"}));
		expect({
			dialog: screen.getByRole("dialog").hasAttribute("data-presentation"),
			presentation: document.querySelector("[data-presentation]"),
			scrim: document.querySelector("[data-sheet-scrim]"),
		}).toStrictEqual({dialog: false, presentation: null, scrim: null});
	});

	it("keeps the settings search results anchored to their input", () => {
		stubCoarseAtWidth(420);
		render(<SettingsSearch onSelect={() => {}} />);
		fireEvent.change(screen.getByRole("textbox", {name: "Search settings"}), {target: {value: "theme"}});
		expect({
			popup: document.querySelector("[role=listbox], [role=dialog]") !== null,
			presentation: document.querySelector("[data-presentation]"),
			scrim: document.querySelector("[data-sheet-scrim]"),
		}).toStrictEqual({popup: true, presentation: null, scrim: null});
	});
});
