// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ConfirmExternalLink} from "../src/components/confirm-external-link";
import {resolveLink} from "../src/lib/external-nav";
import {installLocalStorage} from "./fake-storage";

const TRUSTED_KEY = "external-nav-trusted-domains";

let storage: ReturnType<typeof installLocalStorage>;
const openWindow = vi.fn<typeof window.open>(() => null);

beforeEach(() => {
	storage = installLocalStorage();
	vi.useFakeTimers();
	vi.stubGlobal("open", openWindow);
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	openWindow.mockClear();
});

function drawLink(href: string) {
	render(
		<p>
			see <ConfirmExternalLink href={href}>{href}</ConfirmExternalLink>
		</p>,
	);
	return screen.getByRole("link", {name: href});
}

/** Upstream `CL`: the confirm button arms 400ms after the dialog shows. */
function arm() {
	act(() => {
		vi.advanceTimersByTime(400);
	});
}

function openLinkButton(): HTMLButtonElement {
	return screen.getByRole("button", {name: "Open link"});
}

describe("ConfirmExternalLink (upstream jq + hz/Ec, the tool body's confirm link policy)", () => {
	it("asks before leaving: title, lead, the URL box and a delayed Open link that opens a new window", () => {
		const link = drawLink("https://e.com/x");
		const notPrevented = fireEvent.click(link);
		const dialog = screen.getByRole("alertdialog");
		const urlBox = dialog.querySelector("div.mt-3.max-h-40");
		const shown = {
			title: screen.getByText("Open external link").tagName,
			lead: screen.getByText("You’re leaving Claude to visit an external link:").tagName,
			urlBox: [urlBox?.className, urlBox?.firstElementChild?.getAttribute("dir"), urlBox?.textContent],
			checkbox: screen.getByRole("checkbox", {name: "Don’t ask again for links to e.com"}).tagName,
		};
		const before = openLinkButton().disabled;
		arm();
		const after = openLinkButton().disabled;
		fireEvent.click(openLinkButton());
		expect({
			notPrevented,
			...shown,
			before,
			after,
			opened: openWindow.mock.calls,
			open: screen.queryByRole("alertdialog"),
		}).toStrictEqual({
			notPrevented: false,
			title: "H2",
			lead: "P",
			urlBox: [
				"mt-3 max-h-40 overflow-y-scroll break-all rounded-lg border bg-surface-1 px-4 py-3 text-primary",
				"ltr",
				"https://e.com/x",
			],
			checkbox: "INPUT",
			before: true,
			after: false,
			opened: [["https://e.com/x", "_blank", "noopener,noreferrer"]],
			open: null,
		});
	});

	it("remembers a domain when Don’t ask again is ticked, then opens its links at once", () => {
		const link = drawLink("https://e.com/x");
		fireEvent.click(link);
		arm();
		fireEvent.click(screen.getByRole("checkbox", {name: "Don’t ask again for links to e.com"}));
		fireEvent.click(openLinkButton());
		fireEvent.click(link);
		expect({
			stored: storage.getItem(TRUSTED_KEY),
			dialog: screen.queryByRole("alertdialog"),
			opened: openWindow.mock.calls.length,
		}).toStrictEqual({stored: '["e.com"]', dialog: null, opened: 2});
	});

	it("cancels without opening anything", () => {
		fireEvent.click(drawLink("https://e.com/x"));
		fireEvent.click(screen.getByRole("button", {name: "Cancel"}));
		expect({dialog: screen.queryByRole("alertdialog"), opened: openWindow.mock.calls}).toStrictEqual({
			dialog: null,
			opened: [],
		});
	});

	it("opens a modifier-clicked plain https link straight away, but asks on a middle click", () => {
		const link = drawLink("https://e.com/x");
		fireEvent.click(link, {metaKey: true});
		const direct = [openWindow.mock.calls.length, screen.queryByRole("alertdialog")];
		fireEvent(link, new MouseEvent("auxclick", {bubbles: true, cancelable: true, button: 1}));
		expect({direct, middle: screen.queryByRole("alertdialog") !== null}).toStrictEqual({
			direct: [1, null],
			middle: true,
		});
	});

	it("warns about a punycode domain and offers no Don’t ask again, even on a modifier click", () => {
		fireEvent.click(drawLink("https://xn--80ak6aa92e.com/"), {metaKey: true});
		const warning = screen.getByText(
			"This link contains an internationalized domain name that may be deceptive. The domain appears as:",
		);
		expect({
			opened: openWindow.mock.calls.length,
			detail: warning.nextElementSibling?.textContent,
			detailDir: warning.nextElementSibling?.getAttribute("dir"),
			box: warning.closest(".border-danger")?.className,
			checkbox: screen.queryByRole("checkbox"),
		}).toStrictEqual({
			opened: 0,
			detail: "аррӏе.com",
			detailDir: "ltr",
			box: "mt-3 rounded-lg border border-danger bg-danger p-3",
			checkbox: null,
		});
	});

	it("warns about embedded credentials with the real host", () => {
		fireEvent.click(drawLink("https://user:pw@e.com/x"));
		const warning = screen.getByText(
			"This link contains embedded credentials, which may be an attempt to disguise its destination. You will actually be sent to:",
		);
		expect({
			detail: warning.nextElementSibling?.textContent,
			testId: warning.closest("[data-testid]")?.getAttribute("data-testid"),
			checkbox: screen.queryByRole("checkbox"),
		}).toStrictEqual({detail: "e.com", testId: "userinfo-warning", checkbox: null});
	});

	it("offers Don’t ask again only for https links", () => {
		fireEvent.click(drawLink("http://e.com/x"));
		expect(screen.queryByRole("checkbox")).toBeNull();
	});

	it("lets a trusted Claude Code docs link navigate itself", () => {
		const notPrevented = fireEvent.click(drawLink("https://code.claude.com/docs"));
		expect({notPrevented, dialog: screen.queryByRole("alertdialog"), opened: openWindow.mock.calls}).toStrictEqual({
			notPrevented: true,
			dialog: null,
			opened: [],
		});
	});
});

describe("resolveLink (upstream cbb72cde9 mr: the href through _0 and cs, then ds under a link policy and c5e04cdc6 n)", () => {
	it("strips open_in_browser, drops unsafe hrefs and claude-host credential routes, and lets each policy pick live, confirm or words", () => {
		const urls = [
			"https://example.com/a?open_in_browser=1&b=2#h",
			"https://example.com/a?b=2",
			"http:example.com/a",
			"https://claude.ai/api/organizations",
			"https://claude.ai/logout/now",
			"https://claude.ai/connect/github",
			"https://xn--e1afmkfd.example/b",
			"https://user:pw@example.com/a",
			"https://xn--e1afmkfd.claude.ai/b",
			"https://xn--e1afmkfd.anthropic.com/logout",
			"https://xn--e1afmkfd.anthropic.com/login",
			"https://xn--e1afmkfd.anthropic.com/upgrade?returnTo=%2Flogout",
		];

		expect(urls.map((url) => [resolveLink(url, "transcript"), resolveLink(url, "option")])).toStrictEqual([
			[
				{treatment: "live", href: "https://example.com/a?b=2#h"},
				{treatment: "live", href: "https://example.com/a?b=2#h"},
			],
			[
				{treatment: "live", href: "https://example.com/a?b=2"},
				{treatment: "live", href: "https://example.com/a?b=2"},
			],
			[{treatment: "words"}, {treatment: "words"}],
			[{treatment: "words"}, {treatment: "words"}],
			[{treatment: "words"}, {treatment: "words"}],
			[{treatment: "words"}, {treatment: "words"}],
			[{treatment: "confirm", href: "https://xn--e1afmkfd.example/b"}, {treatment: "words"}],
			[{treatment: "words"}, {treatment: "words"}],
			[{treatment: "words"}, {treatment: "words"}],
			[{treatment: "words"}, {treatment: "words"}],
			[{treatment: "confirm", href: "https://xn--e1afmkfd.anthropic.com/login"}, {treatment: "words"}],
			[{treatment: "words"}, {treatment: "words"}],
		]);
	});
});
