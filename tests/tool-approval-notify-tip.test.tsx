// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SettingsProvider} from "../src/components/settings-provider";
import {ToolApprovalNotifyTip} from "../src/components/tool-approval-notify-tip";
import {resetNotifyTipTriggers} from "../src/lib/notify-tip";
import {installLocalStorage} from "./fake-storage";

const SESSION = "session-test-100";
const SHOWS_KEY = "ccp-tool-approval-notify-tip-shows";
const OFFER = "Get notified when you’re needed";
const ASKING = "Choose Allow in your browser’s popup";
const ON = "Notifications on";
const BLOCKED = "Notifications are blocked";

function stubNotification(permission: NotificationPermission, answer: Promise<NotificationPermission>) {
	const requestPermission = vi.fn<typeof Notification.requestPermission>(async () => answer);
	vi.stubGlobal(
		"Notification",
		Object.assign(function Notification() {}, {permission, requestPermission}),
	);
	return requestPermission;
}

function setHidden(hidden: boolean) {
	Object.defineProperty(document, "hidden", {configurable: true, get: () => hidden});
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		get: () => (hidden ? "hidden" : "visible"),
	});
	act(() => {
		document.dispatchEvent(new Event("visibilitychange"));
	});
}

async function renderTip() {
	const view = render(
		<SettingsProvider>
			<ToolApprovalNotifyTip sessionId={SESSION} />
		</SettingsProvider>,
	);
	await act(async () => {});
	return view;
}

function advance(ms: number) {
	act(() => {
		vi.advanceTimersByTime(ms);
	});
}

/** Leaves the tab for upstream's 30s while the approval waits, then comes back. */
function leaveAndReturn() {
	setHidden(true);
	advance(30_000);
	setHidden(false);
}

function tip() {
	const status = screen.queryByRole("status");
	return {
		text: status?.getAttribute("aria-hidden") === "true" ? null : (status?.textContent ?? null),
		turnOn: screen.queryByRole("button", {name: "Turn on"}) !== null,
	};
}

function storedShows(): unknown {
	const raw = localStorage.getItem(SHOWS_KEY);
	return raw === null ? null : JSON.parse(raw);
}

beforeEach(() => {
	vi.useFakeTimers({now: 1_000_000});
	installLocalStorage();
	resetNotifyTipTriggers();
	setHidden(false);
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({matches: false, addEventListener: () => {}, removeEventListener: () => {}})),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("tool-approval notify tip", () => {
	it("waits until the user comes back after 30s away, then offers Turn on and counts one show", async () => {
		stubNotification("default", Promise.resolve("granted"));
		await renderTip();
		const before = tip();
		setHidden(true);
		advance(29_000);
		setHidden(false);
		const shortAbsence = tip();
		leaveAndReturn();
		const returned = tip();
		const showsBeforeSecond = storedShows();
		advance(1_000);

		expect({before, shortAbsence, returned, showsBeforeSecond, shows: storedShows()}).toStrictEqual({
			before: {text: null, turnOn: false},
			shortAbsence: {text: null, turnOn: false},
			returned: {text: OFFER, turnOn: true},
			showsBeforeSecond: null,
			shows: {count: 1, lastShownAt: 1_060_000},
		});
	});

	it("stops showing after three shows", async () => {
		stubNotification("default", Promise.resolve("granted"));
		localStorage.setItem(SHOWS_KEY, JSON.stringify({count: 3, lastShownAt: 0}));
		await renderTip();
		leaveAndReturn();

		expect(tip()).toStrictEqual({text: null, turnOn: false});
	});

	it("does not count a second show within 10s of the last", async () => {
		stubNotification("default", Promise.resolve("granted"));
		localStorage.setItem(SHOWS_KEY, JSON.stringify({count: 1, lastShownAt: 1_025_000}));
		await renderTip();
		leaveAndReturn();
		advance(1_000);

		expect({tip: tip(), shows: storedShows()}).toStrictEqual({
			tip: {text: OFFER, turnOn: true},
			shows: {count: 1, lastShownAt: 1_025_000},
		});
	});

	it("asks in the browser popup, then says Notifications on and folds away after 3s", async () => {
		let grant: (permission: NotificationPermission) => void = () => {};
		const requestPermission = stubNotification(
			"default",
			new Promise((resolve) => {
				grant = resolve;
			}),
		);
		await renderTip();
		leaveAndReturn();
		act(() => {
			fireEvent.click(screen.getByRole("button", {name: "Turn on"}));
		});
		const asking = tip();
		act(() => {
			grant("granted");
		});
		await act(async () => {});
		const on = tip();
		advance(3_000);

		expect({
			asking,
			on,
			gone: tip(),
			requested: requestPermission.mock.calls.length,
			setting: localStorage.getItem("ccp-notify-permission-requests"),
		}).toStrictEqual({
			asking: {text: ASKING, turnOn: false},
			on: {text: ON, turnOn: false},
			gone: {text: null, turnOn: false},
			requested: 1,
			setting: "true",
		});
	});

	it("says Notifications are blocked when the browser refuses", async () => {
		stubNotification("default", Promise.resolve("denied"));
		await renderTip();
		leaveAndReturn();
		act(() => {
			fireEvent.click(screen.getByRole("button", {name: "Turn on"}));
		});
		await act(async () => {});

		expect({tip: tip(), setting: localStorage.getItem("ccp-notify-permission-requests")}).toStrictEqual({
			tip: {text: BLOCKED, turnOn: false},
			setting: null,
		});
	});

	it("turns on without a popup when permission is granted but permission requests are off", async () => {
		const requestPermission = stubNotification("granted", Promise.resolve("granted"));
		await renderTip();
		leaveAndReturn();
		const offer = tip();
		act(() => {
			fireEvent.click(screen.getByRole("button", {name: "Turn on"}));
		});
		await act(async () => {});

		expect({offer, after: tip(), requested: requestPermission.mock.calls.length}).toStrictEqual({
			offer: {text: OFFER, turnOn: true},
			after: {text: ON, turnOn: false},
			requested: 0,
		});
	});

	it("is hidden when permission requests already notify", async () => {
		stubNotification("granted", Promise.resolve("granted"));
		localStorage.setItem("ccp-notify-permission-requests", "true");
		await renderTip();
		leaveAndReturn();

		expect(tip()).toStrictEqual({text: null, turnOn: false});
	});

	it("is hidden when this session is opted in with Notify", async () => {
		stubNotification("granted", Promise.resolve("granted"));
		localStorage.setItem("ccp-notify-sessions", JSON.stringify([SESSION]));
		await renderTip();
		leaveAndReturn();

		expect(tip()).toStrictEqual({text: null, turnOn: false});
	});

	it("says Notifications are blocked, with no Turn on, when permission was already denied", async () => {
		stubNotification("denied", Promise.resolve("denied"));
		await renderTip();
		leaveAndReturn();

		expect(tip()).toStrictEqual({text: BLOCKED, turnOn: false});
	});

	it("is hidden when the browser has no Notification API", async () => {
		await renderTip();
		leaveAndReturn();

		expect(tip()).toStrictEqual({text: null, turnOn: false});
	});
});
