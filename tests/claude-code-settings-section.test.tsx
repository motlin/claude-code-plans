// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SettingsProvider} from "../src/components/settings-provider";
import {ClaudeCodeSettings} from "../src/components/settings/settings-sections";
import {ThemeProvider} from "../src/components/theme-provider";
import type {ClaudeCodeSettingsState} from "../src/lib/claude-code-settings-schema";
import {installLocalStorage} from "./fake-storage";

interface Posted {
	key: string;
	value?: unknown;
	expectedMtimeMs: number | null;
}

/** A fake /api/claude-code-settings: GET serves `state`; each POST waits for a test-controlled reply. */
function fakeEndpoint(initial: ClaudeCodeSettingsState) {
	let state = initial;
	const posts: Posted[] = [];
	const pending: Array<(reply: "ok" | "conflict" | "fail") => void> = [];
	const json = (body: unknown, status = 200) =>
		new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}});

	const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async (input, init) => {
		if (!input.endsWith("/api/claude-code-settings")) return new Promise<Response>(() => {});
		if (init?.method !== "POST") return json(state);
		const body = JSON.parse(String(init.body)) as Posted;
		posts.push(body);
		return new Promise<Response>((resolve) => {
			pending.push((reply) => {
				if (reply === "conflict") {
					resolve(json(state, 409));
					return;
				}
				if (reply === "fail") {
					resolve(json({error: "boom"}, 422));
					return;
				}
				const others = Object.entries(state.values).filter(([key]) => key !== body.key);
				const values = Object.fromEntries(
					body.value === undefined ? others : [...others, [body.key, body.value]],
				) as ClaudeCodeSettingsState["values"];
				state = {...state, mtimeMs: (state.mtimeMs ?? 0) + 1, values};
				resolve(json(state));
			});
		});
	});

	return {
		fetchMock,
		posts,
		/** Answer the index-th POST once it has been sent (writes go out on a microtask). */
		async reply(index: number, reply: "ok" | "conflict" | "fail") {
			await waitFor(() => {
				expect(pending.length).toBeGreaterThan(index);
			});
			await act(async () => {
				pending[index]?.(reply);
				await Promise.resolve();
			});
		},
	};
}

let queryClient: QueryClient;

/** Wait until the GET has answered and the rows no longer read Loading…. */
async function settled() {
	await waitFor(() => {
		expect(switchIn("local-sandbox").disabled).toBeNull();
	});
}

async function renderTab() {
	queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	render(
		<QueryClientProvider client={queryClient}>
			<ThemeProvider>
				<SettingsProvider>
					<ClaudeCodeSettings />
				</SettingsProvider>
			</ThemeProvider>
		</QueryClientProvider>,
	);
	await act(async () => {});
}

function row(slug: string): HTMLElement {
	const element = document.querySelector<HTMLElement>(`[data-settings-row="${slug}"]`);
	if (element === null) throw new Error(`no row ${slug}`);
	return element;
}

function switchIn(slug: string) {
	const element = within(row(slug)).getByRole("switch");
	return {
		element,
		checked: element.getAttribute("aria-checked"),
		disabled: element.getAttribute("aria-disabled"),
	};
}

beforeEach(() => {
	installLocalStorage();
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({matches: false, addEventListener: () => {}, removeEventListener: () => {}})),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("Claude Code settings ▸ Sessions", () => {
	it("renders section#local-sessions after Appearance with upstream's rows and copy", async () => {
		vi.stubGlobal("fetch", fakeEndpoint({mtimeMs: 1, values: {}}).fetchMock);
		await renderTab();
		await settled();

		const section = document.querySelector<HTMLElement>("section#local-sessions");
		expect({
			sections: [...document.querySelectorAll("section[data-settings-section-titled]")].map((s) => s.id),
			heading: section?.querySelector("h3")?.textContent,
			rows: [...(section?.querySelectorAll<HTMLElement>("[data-settings-row]") ?? [])].map((r) => ({
				slug: r.dataset["settingsRow"],
				title: r.querySelector(".settings-row-title")?.textContent,
				description: r.querySelector("[data-settings-desc]")?.textContent,
			})),
		}).toStrictEqual({
			sections: ["code-appearance", "appearance", "local-sessions"],
			heading: "Sessions",
			rows: [
				{
					slug: "allow-bypass-permissions-mode",
					title: "Allow bypass permissions mode",
					description:
						"Bypass all permission checks and let Claude work uninterrupted. This works well for workflows like fixing lint errors or generating boilerplate code. Letting Claude run arbitrary commands is risky and can result in data loss, system corruption, or data exfiltration (e.g., via prompt injection attacks). See best practices for safe usage(opens in new tab)",
				},
				{
					slug: "dynamic-workflows",
					title: "Dynamic workflows",
					description:
						"Let Claude run multiple agents in parallel for complex tasks. Workflows can use a lot of your usage limit quickly.",
				},
				{
					slug: "local-sandbox",
					title: "Local sandbox",
					description: "Runs commands from Claude Code in an isolated sandbox. Applies to new sessions.",
				},
			],
		});
	});

	it("links the bypass description to the security best practices in a new tab", async () => {
		vi.stubGlobal("fetch", fakeEndpoint({mtimeMs: 1, values: {}}).fetchMock);
		await renderTab();
		await settled();

		const link = within(row("allow-bypass-permissions-mode")).getByRole("link");
		expect({
			name: link.textContent,
			href: link.getAttribute("href"),
			target: link.getAttribute("target"),
			rel: link.getAttribute("rel"),
			srOnly: link.querySelector(".sr-only")?.textContent,
		}).toStrictEqual({
			name: "See best practices for safe usage(opens in new tab)",
			href: "https://code.claude.com/docs/en/security",
			target: "_blank",
			rel: "noopener",
			srOnly: "(opens in new tab)",
		});
	});

	it("disables the controls and reads Loading… while settings load", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Promise<Response>(() => {})),
		);
		await renderTab();

		expect(
			["allow-bypass-permissions-mode", "dynamic-workflows", "local-sandbox"].map((slug) => ({
				disabled: switchIn(slug).disabled,
				description: row(slug).querySelector("[data-settings-desc]")?.textContent,
			})),
		).toStrictEqual([
			{disabled: "true", description: "Loading…"},
			{disabled: "true", description: "Loading…"},
			{disabled: "true", description: "Loading…"},
		]);
	});

	it("reflects the file: bypass and sandbox on only when true, workflows on unless false", async () => {
		vi.stubGlobal(
			"fetch",
			fakeEndpoint({
				mtimeMs: 1,
				values: {skipDangerousModePermissionPrompt: true, enableWorkflows: false, "sandbox.enabled": true},
			}).fetchMock,
		);
		await renderTab();

		await waitFor(() => {
			expect(
				["allow-bypass-permissions-mode", "dynamic-workflows", "local-sandbox"].map(
					(slug) => switchIn(slug).checked,
				),
			).toStrictEqual(["true", "false", "true"]);
		});
	});

	it("defaults to bypass off, workflows on and sandbox off", async () => {
		vi.stubGlobal("fetch", fakeEndpoint({mtimeMs: null, values: {}}).fetchMock);
		await renderTab();

		await waitFor(() => {
			expect(
				["allow-bypass-permissions-mode", "dynamic-workflows", "local-sandbox"].map((slug) => ({
					checked: switchIn(slug).checked,
					disabled: switchIn(slug).disabled,
				})),
			).toStrictEqual([
				{checked: "false", disabled: null},
				{checked: "true", disabled: null},
				{checked: "false", disabled: null},
			]);
		});
	});

	it("writes skipDangerousModePermissionPrompt: true on, delete off, and refreshes the composer defaults", async () => {
		const endpoint = fakeEndpoint({mtimeMs: 5, values: {}});
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await waitFor(() => {
			expect(switchIn("allow-bypass-permissions-mode").disabled).toBeNull();
		});
		const invalidate = vi.spyOn(queryClient, "invalidateQueries");

		fireEvent.click(switchIn("allow-bypass-permissions-mode").element);
		expect(switchIn("allow-bypass-permissions-mode").checked).toBe("true");
		await endpoint.reply(0, "ok");
		await waitFor(() => {
			expect(switchIn("allow-bypass-permissions-mode").checked).toBe("true");
		});

		fireEvent.click(switchIn("allow-bypass-permissions-mode").element);
		await waitFor(() => {
			expect(endpoint.posts).toHaveLength(2);
		});
		await endpoint.reply(1, "ok");
		await waitFor(() => {
			expect(switchIn("allow-bypass-permissions-mode").checked).toBe("false");
		});

		expect({
			posts: endpoint.posts,
			composerInvalidated: invalidate.mock.calls.some(
				([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(["composer-defaults"]),
			),
		}).toStrictEqual({
			posts: [
				{key: "skipDangerousModePermissionPrompt", value: true, expectedMtimeMs: 5},
				{key: "skipDangerousModePermissionPrompt", expectedMtimeMs: 6},
			],
			composerInvalidated: true,
		});
	});

	it("locks the bypass switch with Managed by your organization when the mode is disabled", async () => {
		vi.stubGlobal("fetch", fakeEndpoint({mtimeMs: 1, values: {}, bypassPermissionsModeDisabled: true}).fetchMock);
		await renderTab();

		await waitFor(() => {
			expect(switchIn("allow-bypass-permissions-mode").disabled).toBe("true");
		});
		expect(within(row("allow-bypass-permissions-mode")).getByText("Managed by your organization")).toBeTruthy();
	});

	it("writes enableWorkflows false when turned off and deletes it when turned back on", async () => {
		const endpoint = fakeEndpoint({mtimeMs: 1, values: {}});
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await waitFor(() => {
			expect(switchIn("dynamic-workflows").disabled).toBeNull();
		});

		fireEvent.click(switchIn("dynamic-workflows").element);
		await endpoint.reply(0, "ok");
		await waitFor(() => {
			expect(switchIn("dynamic-workflows").checked).toBe("false");
		});
		fireEvent.click(switchIn("dynamic-workflows").element);
		await waitFor(() => {
			expect(endpoint.posts).toHaveLength(2);
		});
		await endpoint.reply(1, "ok");

		expect(endpoint.posts).toStrictEqual([
			{key: "enableWorkflows", value: false, expectedMtimeMs: 1},
			{key: "enableWorkflows", expectedMtimeMs: 2},
		]);
	});

	it("writes sandbox.enabled true and false", async () => {
		const endpoint = fakeEndpoint({mtimeMs: 1, values: {}});
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await waitFor(() => {
			expect(switchIn("local-sandbox").disabled).toBeNull();
		});

		fireEvent.click(switchIn("local-sandbox").element);
		await endpoint.reply(0, "ok");
		await waitFor(() => {
			expect(switchIn("local-sandbox").checked).toBe("true");
		});
		fireEvent.click(switchIn("local-sandbox").element);
		await waitFor(() => {
			expect(endpoint.posts).toHaveLength(2);
		});
		await endpoint.reply(1, "ok");

		expect(endpoint.posts).toStrictEqual([
			{key: "sandbox.enabled", value: true, expectedMtimeMs: 1},
			{key: "sandbox.enabled", value: false, expectedMtimeMs: 2},
		]);
	});

	it("reverts a refused write and shows Couldn’t save this setting. under the row", async () => {
		const endpoint = fakeEndpoint({mtimeMs: 1, values: {}});
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await waitFor(() => {
			expect(switchIn("local-sandbox").disabled).toBeNull();
		});

		fireEvent.click(switchIn("local-sandbox").element);
		expect(switchIn("local-sandbox").checked).toBe("true");
		await endpoint.reply(0, "conflict");

		await waitFor(() => {
			expect(screen.getByRole("alert").textContent).toBe("Couldn’t save this setting.");
		});
		const alert = screen.getByRole("alert");
		expect({
			checked: switchIn("local-sandbox").checked,
			alertParent: alert.parentElement?.className,
			rowClass: row("local-sandbox").className.includes("flex-col"),
			inRow: row("local-sandbox").contains(alert),
		}).toStrictEqual({
			checked: "false",
			alertParent: "text-footnote text-danger",
			rowClass: true,
			inRow: true,
		});
	});

	it("ignores an older write's response once a newer write supersedes it", async () => {
		const endpoint = fakeEndpoint({mtimeMs: 1, values: {}});
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await waitFor(() => {
			expect(switchIn("dynamic-workflows").disabled).toBeNull();
		});

		// Off, then back on before the first write answers: the first one fails, but the
		// newer write is the one the row shows, so no alert appears and the switch stays on.
		fireEvent.click(switchIn("dynamic-workflows").element);
		fireEvent.click(switchIn("dynamic-workflows").element);
		expect(switchIn("dynamic-workflows").checked).toBe("true");
		await endpoint.reply(0, "fail");
		await waitFor(() => {
			expect(endpoint.posts).toHaveLength(2);
		});
		await endpoint.reply(1, "ok");

		await waitFor(() => {
			expect({
				checked: switchIn("dynamic-workflows").checked,
				alerts: screen.queryAllByRole("alert").length,
			}).toStrictEqual({checked: "true", alerts: 0});
		});
	});
});
