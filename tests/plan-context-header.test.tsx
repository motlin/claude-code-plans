// @vitest-environment jsdom

import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {PlanContextHeader, type PlanContextLink} from "../src/components/plan-context-header";

afterEach(() => {
	cleanup();
});

const NOW = Date.parse("2026-10-17T12:00:00Z");

async function renderWithRouter(node: ReactNode) {
	const rootRoute = createRootRoute({component: (): ReactNode => node});
	const router = createRouter({routeTree: rootRoute, history: createMemoryHistory({initialEntries: ["/"]})});
	await router.load();
	return render(<RouterProvider router={router} />);
}

function rows() {
	const header = screen.getByTestId("plan-context");
	return Array.from(header.querySelectorAll("a, button"), (el) => ({
		tag: el.tagName.toLowerCase(),
		href: el.getAttribute("href"),
		label: el.querySelector("[data-rail-row-label]")?.textContent ?? null,
		hint: el.querySelector("[data-rail-row-hint]")?.textContent ?? null,
	}));
}

function link(sessionId: string, sessionTitle: string | null, modifiedIso: string): PlanContextLink {
	return {
		sessionId,
		project: "-Users-fabricated-projects-alpha",
		projectName: "alpha",
		projectDir: "~/projects/alpha",
		sessionTitle,
		sessionModified: modifiedIso,
	};
}

describe("PlanContextHeader", () => {
	it("shows the project directory then each session newest first with upstream's relative time", async () => {
		await renderWithRouter(
			<PlanContextHeader
				links={[
					link("sess-old", "Draft the fabricated plan", "2026-10-15T12:00:00Z"),
					link("sess-new", null, "2026-10-17T10:00:00Z"),
				]}
				now={NOW}
			/>,
		);
		expect(rows()).toStrictEqual([
			{tag: "a", href: "/project/-Users-fabricated-projects-alpha", label: "~/projects/alpha", hint: null},
			{tag: "a", href: "/session/sess-new", label: "Untitled session", hint: "2h ago"},
			{tag: "a", href: "/session/sess-old", label: "Draft the fabricated plan", hint: "2d ago"},
		]);
	});

	it("collapses more than three sessions behind an N sessions disclosure", async () => {
		await renderWithRouter(
			<PlanContextHeader
				links={[
					link("s1", "One", "2026-10-17T11:00:00Z"),
					link("s2", "Two", "2026-10-17T10:00:00Z"),
					link("s3", "Three", "2026-10-17T09:00:00Z"),
					link("s4", "Four", "2026-10-17T08:00:00Z"),
				]}
				now={NOW}
			/>,
		);
		expect(rows()).toStrictEqual([
			{tag: "a", href: "/project/-Users-fabricated-projects-alpha", label: "~/projects/alpha", hint: null},
			{tag: "button", href: null, label: "4 sessions", hint: null},
		]);
		const disclosure = screen.getByRole("button", {name: "4 sessions"});
		expect(disclosure.getAttribute("aria-expanded")).toBe("false");

		fireEvent.click(disclosure);

		expect(disclosure.getAttribute("aria-expanded")).toBe("true");
		expect(rows()).toStrictEqual([
			{tag: "a", href: "/project/-Users-fabricated-projects-alpha", label: "~/projects/alpha", hint: null},
			{tag: "button", href: null, label: "4 sessions", hint: null},
			{tag: "a", href: "/session/s1", label: "One", hint: "1h ago"},
			{tag: "a", href: "/session/s2", label: "Two", hint: "2h ago"},
			{tag: "a", href: "/session/s3", label: "Three", hint: "3h ago"},
			{tag: "a", href: "/session/s4", label: "Four", hint: "4h ago"},
		]);
	});

	it("renders nothing when the plan has no linked sessions", async () => {
		await renderWithRouter(
			<div data-testid="host">
				<PlanContextHeader links={[]} now={NOW} />
			</div>,
		);
		expect(screen.getByTestId("host").innerHTML).toBe("");
	});
});
