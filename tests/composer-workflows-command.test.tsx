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

beforeAll(async () => {
	await preloadComposerSurfaces();
});

afterEach(() => {
	cleanup();
	localStorage.clear();
});

function task(overrides: Partial<BackgroundTask> & Pick<BackgroundTask, "id">): BackgroundTask {
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
		...overrides,
	};
}

// Something running keeps Finished collapsed until /workflows expands it.
const GROUPS: BackgroundTaskGroups = {
	running: [task({id: "bfab1serve", description: "Serve the fabricated app", command: "pnpm dev"})],
	finished: [
		task({
			id: "bfab1build",
			description: "Build the fabricated app",
			command: "pnpm build",
			status: "completed",
			output: "built in 1.2s",
		}),
	],
};

/** A session composer beside a pane host that shows the Background tasks pane once opened. */
function setup(sessionId: string) {
	const onSend = vi.fn<(prompt: string) => void>();
	const opened: PaneKind[] = [];
	function Harness() {
		const [open, setOpen] = useState<readonly PaneKind[]>([]);
		const host = useMemo<PaneHostApi>(
			() => ({
				layout: {} as PaneHostApi["layout"],
				openKinds: open,
				isOpen: (kind) => open.includes(kind),
				openPane: (kind) => {
					opened.push(kind);
					setOpen((kinds) => [...kinds, kind]);
				},
				closePane: () => {},
				togglePane: () => {},
			}),
			[open],
		);
		return (
			<PaneHostContext.Provider value={host}>
				<ToastProvider>
					<SessionBackgroundTasksOpener sessionId={sessionId} running={new Map()}>
						<Composer variant="session" draftKey={`session-${sessionId}`} onSend={onSend} />
					</SessionBackgroundTasksOpener>
				</ToastProvider>
				{open.includes("background-tasks") && <BackgroundTasksList groups={GROUPS} sessionId={sessionId} />}
			</PaneHostContext.Provider>
		);
	}
	render(<Harness />);
	const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
	return {textarea, onSend, opened};
}

function send(textarea: HTMLTextAreaElement, text: string) {
	fireEvent.change(textarea, {target: {value: text}});
	fireEvent.keyDown(textarea, {key: "Enter"});
}

function finishedToggle() {
	return screen.queryByRole("button", {name: /^Finished/})?.getAttribute("aria-expanded");
}

describe("/workflows", () => {
	it("opens the Background tasks pane with Finished expanded and clears the composer instead of sending", () => {
		const {textarea, onSend, opened} = setup("s-workflows");

		send(textarea, "/workflows");

		expect({
			sends: onSend.mock.calls,
			opened,
			text: textarea.value,
			finished: finishedToggle(),
		}).toStrictEqual({sends: [], opened: ["background-tasks"], text: "", finished: "true"});
	});

	it("answers to the /workflow alias", () => {
		const {textarea, onSend, opened} = setup("s-workflow-alias");

		send(textarea, "/workflow");

		expect({sends: onSend.mock.calls, opened, finished: finishedToggle()}).toStrictEqual({
			sends: [],
			opened: ["background-tasks"],
			finished: "true",
		});
	});

	it("refuses /workflows with arguments with upstream's noArgs band", () => {
		const {textarea, onSend, opened} = setup("s-workflows-args");

		send(textarea, "/workflows all");

		expect({
			sends: onSend.mock.calls,
			opened,
			text: textarea.value,
			band: screen.queryByText(
				"/workflows doesn’t take arguments here. Remove the text after the command, then send it again.",
			)?.textContent,
		}).toStrictEqual({
			sends: [],
			opened: [],
			text: "/workflows all",
			band: "/workflows doesn’t take arguments here. Remove the text after the command, then send it again.",
		});
	});

	it("sends /workflows to the CLI as typed where no Background tasks pane can open", () => {
		const onSend = vi.fn<(prompt: string) => void>();
		render(
			<ToastProvider>
				<Composer variant="home" draftKey="home" onSend={onSend} />
			</ToastProvider>,
		);
		send(screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"}), "/workflows");

		expect(onSend.mock.calls).toStrictEqual([["/workflows", {}]]);
	});
});
