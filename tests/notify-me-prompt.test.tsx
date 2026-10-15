// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {NotifyMePrompt} from "../src/components/notify-me-prompt";
import {SettingsProvider} from "../src/components/settings-provider";
import {ToastContext, type ToastOptions} from "../src/components/toast-context";
import {readNotifySessions} from "../src/lib/notify-sessions";
import {installLocalStorage} from "./fake-storage";

const SESSION = "session-test-100";
const PROMPT = "Want to be notified when Claude responds?";

let toasts: ToastOptions[];

function pushToast(options: ToastOptions) {
	toasts.push(options);
}

function stubNotification(permission: NotificationPermission, answer: NotificationPermission = permission) {
	const requestPermission = vi.fn<typeof Notification.requestPermission>(async () => Promise.resolve(answer));
	vi.stubGlobal(
		"Notification",
		Object.assign(function Notification() {}, {permission, requestPermission}),
	);
	return requestPermission;
}

async function renderPrompt() {
	render(
		<ToastContext.Provider value={pushToast}>
			<SettingsProvider>
				<NotifyMePrompt sessionId={SESSION} />
			</SettingsProvider>
		</ToastContext.Provider>,
	);
	await act(async () => {});
}

function visible() {
	return {
		prompt: screen.queryByText(PROMPT) !== null,
		button: screen.queryByRole("button", {name: "Notify"}) !== null,
	};
}

async function clickNotify() {
	act(() => {
		fireEvent.click(screen.getByRole("button", {name: "Notify"}));
	});
	await act(async () => {});
}

beforeEach(() => {
	installLocalStorage();
	toasts = [];
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({matches: false, addEventListener: () => {}, removeEventListener: () => {}})),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("composer Notify me prompt", () => {
	it("offers Notify until the browser grants permission, then opts the session in", async () => {
		const requestPermission = stubNotification("default", "granted");
		await renderPrompt();
		const before = visible();
		await clickNotify();

		expect({
			before,
			after: visible(),
			requested: requestPermission.mock.calls.length,
			optedIn: [...readNotifySessions()],
			toasts,
		}).toStrictEqual({
			before: {prompt: true, button: true},
			after: {prompt: false, button: false},
			requested: 1,
			optedIn: [SESSION],
			toasts: [],
		});
	});

	it("spaces the band's row with upstream's gap-1.5", async () => {
		stubNotification("default", "granted");
		await renderPrompt();
		const row = screen.getByText("Want to be notified when Claude responds?").parentElement;
		expect(row?.className.split(" ").filter((name) => name.startsWith("gap-"))).toStrictEqual(["gap-1.5"]);
	});

	it("is hidden when permission is granted and completions notify for every session", async () => {
		stubNotification("granted");
		await renderPrompt();

		expect(visible()).toStrictEqual({prompt: false, button: false});
	});

	it("offers Notify with completions off and opts in without asking again", async () => {
		const requestPermission = stubNotification("granted");
		localStorage.setItem("ccp-notify-completions", "false");
		await renderPrompt();
		const before = visible();
		await clickNotify();

		expect({
			before,
			after: visible(),
			requested: requestPermission.mock.calls.length,
			optedIn: [...readNotifySessions()],
		}).toStrictEqual({
			before: {prompt: true, button: true},
			after: {prompt: false, button: false},
			requested: 0,
			optedIn: [SESSION],
		});
	});

	it("stays hidden for a session that is already opted in", async () => {
		stubNotification("granted");
		localStorage.setItem("ccp-notify-completions", "false");
		localStorage.setItem("ccp-notify-sessions", JSON.stringify([SESSION]));
		await renderPrompt();

		expect(visible()).toStrictEqual({prompt: false, button: false});
	});

	it("shows upstream's blocked toast when the browser refuses", async () => {
		stubNotification("default", "denied");
		await renderPrompt();
		await clickNotify();

		expect({after: visible(), optedIn: [...readNotifySessions()], toasts}).toStrictEqual({
			after: {prompt: false, button: false},
			optedIn: [],
			toasts: [
				{
					kind: "error",
					message:
						"Notifications are blocked. Allow them in your browser or system settings, then try again.",
				},
			],
		});
	});

	it("is hidden when notifications are already blocked", async () => {
		stubNotification("denied");
		await renderPrompt();

		expect(visible()).toStrictEqual({prompt: false, button: false});
	});

	it("is hidden when the browser has no Notification API", async () => {
		await renderPrompt();

		expect(visible()).toStrictEqual({prompt: false, button: false});
	});
});
