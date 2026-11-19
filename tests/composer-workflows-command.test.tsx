// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {useMemo, useState} from "react";
import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";

import {Composer} from "../src/components/composer";
import {preloadComposerSurfaces} from "../src/components/composer-surfaces-entry";
import {BackgroundTasksList} from "../src/components/panes/background-tasks-pane";
import {PaneHostContext, type PaneHostApi} from "../src/components/panes/pane-host-context";
import {SessionBackgroundTasksOpener} from "../src/components/subagent-opener";
import {ToastProvider} from "../src/components/toast";
import type {BackgroundTask, BackgroundTaskGroups} from "../src/lib/background-tasks";
import type {PaneKind} from "../src/lib/pane-layout";
import
{
	BUILTIN_SLASH_COMMANDS,
	cliTwinCommands,
	mergeSlashCommands,
	type SlashCommand,
} from "../src/lib/slash-commands";

beforeAll(async () =>
{
	await preloadComposerSurfaces();
});

afterEach(() =>
{
	cleanup();
	localStorage.clear();
});

function task(overrides: Partial<BackgroundTask> & Pick<BackgroundTask, "id">): BackgroundTask
{
	return {
		toolUseId: null,
		kind: "bash",
		description: "",
		command: null,
		status: "running",
		output: null,
		summary: null,
		outputFile: null,
		startedAt: null,
		completedAt: null,
		durationMs: null,
		...overrides,
	};
}

// Something running keeps Finished collapsed until /workflows expands it.
const GROUPS: BackgroundTaskGroups =
{
	running: [
		task(
			{
				id: "bfab1serve",
				description: "Serve the fabricated app",
				command: "pnpm dev",
			},
		),
	],
	finished: [
		task(
			{
				id: "bfab1build",
				description: "Build the fabricated app",
				command: "pnpm build",
				status: "completed",
				output: "built in 1.2s",
			},
		),
	],
};

/** A session composer beside a pane host that shows the Background tasks pane once opened. */
function setup(sessionId: string, slashCommands?: readonly SlashCommand[])
{
	const onSend = vi.fn<(prompt: string, launchOptions: unknown, routing?: unknown) => void>();
	const opened: PaneKind[] = [];
	function Harness()
	{
		const [open, setOpen] = useState<readonly PaneKind[]>([]);
		const host = useMemo<PaneHostApi>(
			() => (
			{
				layout: {} as PaneHostApi["layout"],
				openKinds: open,
				isOpen: (kind) => open.includes(kind),
				openPane: (kind) =>
				{
					opened.push(kind);
					setOpen((kinds) => [...kinds, kind]);
				},
				closePane: () =>
				{
				},
				togglePane: () =>
				{
				},
			}),
			[open],
		);
		return (
			<PaneHostContext.Provider value={host}>
				<ToastProvider>
					<SessionBackgroundTasksOpener sessionId={sessionId} running={new Map()}>
						<Composer
							variant="session"
							draftKey={`session-${sessionId}`}
							onSend={onSend}
							{...(slashCommands === undefined
								? {}
								:
									{
										slashCommands,
									})}
						/>
					</SessionBackgroundTasksOpener>
				</ToastProvider>
				{open.includes("background-tasks") && <BackgroundTasksList groups={GROUPS} sessionId={sessionId} />}
			</PaneHostContext.Provider>
		);
	}
	render(<Harness />);
	const textarea = screen.getByRole<HTMLTextAreaElement>(
		"textbox",
		{
			name: "Prompt",
		},
	);
	return {
		textarea,
		onSend,
		opened,
	};
}

function send(textarea: HTMLTextAreaElement, text: string)
{
	fireEvent.change(
		textarea,
		{
			target:
			{
				value: text,
			},
		},
	);
	fireEvent.keyDown(
		textarea,
		{
			key: "Enter",
		},
	);
}

function finishedToggle()
{
	return screen
		.queryByRole(
			"button",
			{
				name: /^Finished/,
			},
		)
		?.getAttribute("aria-expanded");
}

describe("/workflows", () =>
{
	it("opens the Background tasks pane with Finished expanded and clears the composer instead of sending", () =>
	{
		const {textarea, onSend, opened} = setup("s-workflows");

		send(textarea, "/workflows");

		expect(
			{
				sends: onSend.mock.calls,
				opened,
				text: textarea.value,
				finished: finishedToggle(),
			},
		).toStrictEqual(
			{
				sends: [],
				opened: ["background-tasks"],
				text: "",
				finished: "true",
			},
		);
	});

	it("answers to the /workflow alias", () =>
	{
		const {textarea, onSend, opened} = setup("s-workflow-alias");

		send(textarea, "/workflow");

		expect(
			{
				sends: onSend.mock.calls,
				opened,
				finished: finishedToggle(),
			},
		).toStrictEqual(
			{
				sends: [],
				opened: ["background-tasks"],
				finished: "true",
			},
		);
	});

	it("refuses /workflows with arguments with upstream's noArgs band", () =>
	{
		const {textarea, onSend, opened} = setup("s-workflows-args");

		send(textarea, "/workflows all");

		expect(
			{
				sends: onSend.mock.calls,
				opened,
				text: textarea.value,
				band: screen.queryByText(
					"/workflows doesn’t take arguments here. Remove the text after the command, then send it again.",
				)?.textContent,
			},
		).toStrictEqual(
			{
				sends: [],
				opened: [],
				text: "/workflows all",
				band: "/workflows doesn’t take arguments here. Remove the text after the command, then send it again.",
			},
		);
	});

	it("sends /workflows to the CLI as typed where no Background tasks pane can open", () =>
	{
		const onSend = vi.fn<(prompt: string) => void>();
		render(
			<ToastProvider>
				<Composer variant="home" draftKey="home" onSend={onSend} />
			</ToastProvider>,
		);
		send(
			screen.getByRole<HTMLTextAreaElement>(
				"textbox",
				{
					name: "Prompt",
				},
			),
			"/workflows",
		);

		expect(onSend.mock.calls).toStrictEqual([["/workflows", {}]]);
	});
});

describe("/workflows Custom command twin", () =>
{
	const COMMANDS = mergeSlashCommands([
		BUILTIN_SLASH_COMMANDS,
		[
			{
				name: "workflows",
				description: "My own workflows",
				source: "personal-command",
			},
		],
	]);

	// Typing moves the caret, and the browser reports it with selectionchange, so React's onSelect sees the caret where
	// the text ends; without it React would report the stale caret on the next keydown, after Enter has accepted a row.
	function type(textarea: HTMLTextAreaElement, text: string)
	{
		fireEvent.change(
			textarea,
			{
				target:
				{
					value: text,
				},
			},
		);
		fireEvent(document, new Event("selectionchange"));
	}

	function key(textarea: HTMLTextAreaElement, name: string)
	{
		fireEvent.keyDown(
			textarea,
			{
				key: name,
			},
		);
	}

	function twinRow(): HTMLElement
	{
		const row = screen.getAllByRole("menuitem").find((item) => item.textContent.includes("Custom command"));
		if (row === undefined) throw new Error("no twin row");
		return row;
	}

	function outcome(onSend: ReturnType<typeof setup>["onSend"], opened: PaneKind[])
	{
		return {
			sends: onSend.mock.calls.map((call) => call[0]),
			opened,
		};
	}

	it("sends a clicked twin's /workflows to the CLI instead of opening the pane, the CLI's own row included", () =>
	{
		const {textarea, onSend, opened} = setup("s-twin-click", COMMANDS);
		type(textarea, "/workflows");
		fireEvent.mouseDown(twinRow());
		key(textarea, "Enter");
		const custom =
		{
			...outcome(onSend, opened),
			routing: onSend.mock.calls[0]?.[2],
		};
		cleanup();

		const cli = setup(
			"s-cli-twin-click",
			mergeSlashCommands([
				BUILTIN_SLASH_COMMANDS,
				cliTwinCommands(
					BUILTIN_SLASH_COMMANDS,
					{
						effortLevels: [],
						fastListed: true,
					},
				),
			]),
		);
		type(cli.textarea, "/workflows");
		fireEvent.mouseDown(twinRow());
		key(cli.textarea, "Enter");

		expect(
			{
				custom,
				cli: outcome(cli.onSend, cli.opened),
			},
		).toStrictEqual(
			{
				custom:
				{
					sends: ["/workflows"],
					opened: [],
					routing:
					{
						cliCommandForced: true,
					},
				},
				cli:
				{
					sends: ["/workflows"],
					opened: [],
				},
			},
		);
	});

	it("routes a twin picked by arrowing onto it and pressing Enter to the CLI", () =>
	{
		const {textarea, onSend, opened} = setup("s-twin-arrow", COMMANDS);

		type(textarea, "/workflows");
		key(textarea, "ArrowDown");
		key(textarea, "Enter");
		key(textarea, "Enter");

		expect(outcome(onSend, opened)).toStrictEqual(
			{
				sends: ["/workflows"],
				opened: [],
			},
		);
	});

	it("keeps the host path for a hovered twin, the auto-highlighted host row, and a twin arrowed onto before the query changed", () =>
	{
		const hovered = setup("s-twin-hover", COMMANDS);
		type(hovered.textarea, "/workflows");
		fireEvent.mouseMove(twinRow());
		key(hovered.textarea, "Enter");
		key(hovered.textarea, "Enter");
		const hover = outcome(hovered.onSend, hovered.opened);
		cleanup();

		const auto = setup("s-twin-auto", COMMANDS);
		type(auto.textarea, "/workflows");
		key(auto.textarea, "Enter");
		key(auto.textarea, "Enter");
		const autoHighlighted = outcome(auto.onSend, auto.opened);
		cleanup();

		const edited = setup("s-twin-edited", COMMANDS);
		type(edited.textarea, "/workflows");
		key(edited.textarea, "ArrowDown");
		type(edited.textarea, "/workflowsx");
		type(edited.textarea, "/workflows");
		key(edited.textarea, "ArrowDown");
		key(edited.textarea, "ArrowUp");
		key(edited.textarea, "ArrowDown");
		type(edited.textarea, "/workflowsx");
		type(edited.textarea, "/workflows");
		key(edited.textarea, "Enter");
		key(edited.textarea, "Enter");
		const afterEdit = outcome(edited.onSend, edited.opened);

		expect(
			{
				hover,
				autoHighlighted,
				afterEdit,
			},
		).toStrictEqual(
			{
				hover:
				{
					sends: [],
					opened: ["background-tasks"],
				},
				autoHighlighted:
				{
					sends: [],
					opened: ["background-tasks"],
				},
				afterEdit:
				{
					sends: [],
					opened: ["background-tasks"],
				},
			},
		);
	});
});
