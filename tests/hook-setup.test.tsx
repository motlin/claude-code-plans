// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {HookSetup} from "../src/components/hook-setup";
import {hookStatusQueryOptions} from "../src/lib/api/hooks";
import {generateHooksConfig, hookInstallStatus} from "../src/lib/hook-config";

vi.mock("../src/components/settings-context", () => ({
	useSettings: () => ({settings: {capabilities: {sessionContextBrief: {enabled: false}}}}),
}));

afterEach(() => {
	cleanup();
});

const HERDR_SCRIPT = "bash '/Users/test/.claude/hooks/herdr-agent-state.sh' session";
const CURRENT_COMMAND = generateHooksConfig().hooks["Stop"]![0]!.hooks[0]!.command;

function commandHook(command: string) {
	return {hooks: [{type: "command", command}]};
}

function renderWith(installed: Record<string, unknown> | undefined) {
	const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
	queryClient.setQueryData(hookStatusQueryOptions.queryKey, {
		...hookInstallStatus(installed),
		settingsPath: "/Users/test/.claude/settings.json",
	});
	render(
		<QueryClientProvider client={queryClient}>
			<HookSetup />
		</QueryClientProvider>,
	);
}

function itemsOf(name: string): string[] {
	const list = screen.getByRole("list", {name});
	return [...list.querySelectorAll("li")].map((item) => item.textContent.replace(/\s+/g, " ").trim());
}

describe("HookSetup", () => {
	it("shows a full current install as on, with no pending changes", () => {
		renderWith(generateHooksConfig().hooks);
		expect({
			banner: screen.getByRole("status").textContent,
			features: new Set(itemsOf("Features the hooks power").map((item) => item.endsWith("On"))),
			changes: screen.queryByRole("list", {name: "Changes Install will make"}),
			button: screen.getByRole("button", {name: "Uninstall Hooks"}).textContent,
		}).toStrictEqual({
			banner: "All 24 hooks installed",
			features: new Set([true]),
			changes: null,
			button: "Uninstall Hooks",
		});
	});

	it("shows herdr's own SessionStart hook kept, older forwarders updated, and per-feature state", () => {
		const older = CURRENT_COMMAND.replace(' or . == "HERDR_SESSION"', "");
		const events = [
			"PreToolUse",
			"PostToolUse",
			"PostToolUseFailure",
			"Stop",
			"SessionEnd",
			"PermissionRequest",
			"Notification",
		];
		renderWith({
			SessionStart: [commandHook(HERDR_SCRIPT)],
			...Object.fromEntries(events.map((name) => [name, [commandHook(older)]])),
			WorktreeCreate: [commandHook(older)],
		});
		const changes = itemsOf("Changes Install will make");
		expect({
			banner: screen.getByRole("status").textContent,
			features: itemsOf("Features the hooks power").slice(0, 4),
			firstChanges: changes.slice(0, 3),
			updateStop: changes.find((item) => item.startsWith("Update Stop")),
			removeStray: changes.find((item) => item.startsWith("Remove")),
			changeCount: changes.length,
			button: screen.getByRole("button", {name: "Install Hooks"}).textContent,
		}).toStrictEqual({
			banner: "7/24 hooks installed, 7 outdated",
			features: [
				"Live session status (active, working, waiting) Off — needs SessionStart, UserPromptSubmit",
				"Live tool activity and instant transcript updates On",
				"Answering questions and permission prompts from the browser Partial — missing optional PermissionDenied",
				"Notifications On",
			],
			firstChanges: [
				`Add SessionStart, keeping 1 other hook: ${HERDR_SCRIPT}`,
				"Add SubagentStart",
				"Add SubagentStop",
			],
			updateStop: "Update Stop: does not forward HERDR_SESSION",
			removeStray:
				"Remove WorktreeCreate: a WorktreeCreate or WorktreeRemove hook replaces git’s own worktree handling",
			changeCount: 24 + 1,
			button: "Install Hooks",
		});
	});

	it("offers Update Hooks when every event is present but some are outdated", () => {
		const older = JSON.parse(
			JSON.stringify(generateHooksConfig().hooks).replaceAll(' or . == \\"HERDR_SESSION\\"', ""),
		) as Record<string, unknown>;
		renderWith(older);
		expect({
			banner: screen.getByRole("status").textContent,
			button: screen.getByRole("button", {name: "Update Hooks"}).textContent,
		}).toStrictEqual({
			banner: "24/24 hooks installed but outdated — Update hooks",
			button: "Update Hooks",
		});
	});

	it("lists every event as an addition and every feature off with nothing installed", () => {
		renderWith(undefined);
		expect({
			banner: screen.getByRole("status").textContent,
			off: itemsOf("Features the hooks power").every((item) => item.includes(" Off — needs ")),
			additions: itemsOf("Changes Install will make").every((item) => item.startsWith("Add ")),
		}).toStrictEqual({banner: "Hooks not installed", off: true, additions: true});
	});
});
