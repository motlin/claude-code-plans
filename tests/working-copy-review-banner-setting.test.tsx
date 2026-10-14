// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {STORAGE_KEYS} from "../src/components/settings-context";
import {SettingsProvider} from "../src/components/settings-provider";
import {SessionsSettings} from "../src/components/settings/settings-sections";
import {WorkingCopyReviewBanner} from "../src/components/working-copy-review-banner";
import {createWorkingCopyReview} from "../src/lib/api/reviews";
import type {Capabilities} from "../src/lib/capabilities";
import {installLocalStorage} from "./fake-storage";

const reviewOffers = vi.hoisted(() => ({listener: null as ((sessionId: string) => void) | null}));

vi.mock("../src/hooks/use-claude-events", () => ({
	useSubscribeReviewOffers: () => (listener: (sessionId: string) => void) => {
		reviewOffers.listener = listener;
		return () => {
			reviewOffers.listener = null;
		};
	},
}));
vi.mock("../src/lib/api/reviews", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/lib/api/reviews")>()),
	createWorkingCopyReview: vi.fn<typeof import("../src/lib/api/reviews").createWorkingCopyReview>(async () =>
		Promise.resolve("review-1"),
	),
	runWorkingCopyReview: vi.fn<typeof import("../src/lib/api/reviews").runWorkingCopyReview>(async () =>
		Promise.resolve({processId: "process-1", completion: new Promise<string>(() => {})}),
	),
}));

const capability: Capabilities["workingCopyReview"] = {
	enabled: true,
	config: {offerMode: "offer"},
	installed: true,
	available: true,
	unavailabilityReason: null,
};

beforeEach(() => {
	installLocalStorage();
	reviewOffers.listener = null;
	vi.mocked(createWorkingCopyReview).mockClear();
});

afterEach(() => {
	cleanup();
});

function renderBanner() {
	render(
		<SettingsProvider>
			<WorkingCopyReviewBanner capability={capability} />
		</SettingsProvider>,
	);
	act(() => {
		reviewOffers.listener?.("offer-session");
	});
}

describe("Settings ▸ Sessions ▸ Offer to review uncommitted changes", () => {
	it("defaults off and persists turning it on", async () => {
		render(
			<SettingsProvider>
				<SessionsSettings />
			</SettingsProvider>,
		);
		await act(async () => {});
		const toggle = screen.getByRole("switch", {name: "Offer to review uncommitted changes"});
		const before = toggle.getAttribute("aria-checked");
		act(() => {
			fireEvent.click(toggle);
		});
		expect({
			before,
			after: toggle.getAttribute("aria-checked"),
			stored: localStorage.getItem(STORAGE_KEYS.offerWorkingCopyReview),
		}).toStrictEqual({before: "false", after: "true", stored: "true"});
	});

	it("hides the banner and skips review work by default", () => {
		renderBanner();
		expect({
			subscribed: reviewOffers.listener !== null,
			banner: screen.queryByText("Review this turn's uncommitted changes?"),
			created: vi.mocked(createWorkingCopyReview).mock.calls.length,
		}).toStrictEqual({subscribed: false, banner: null, created: 0});
	});

	it("shows the banner when the setting is on", () => {
		localStorage.setItem(STORAGE_KEYS.offerWorkingCopyReview, "true");
		renderBanner();
		expect(screen.getByText("Review this turn's uncommitted changes?").textContent).toBe(
			"Review this turn's uncommitted changes?",
		);
	});
});
