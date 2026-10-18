// @vitest-environment jsdom

import {act, cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import type {JumpTargetWindow} from "../src/components/jump-target-context";
import {useRegisterBackgroundTasksPane} from "../src/components/panes/background-tasks-pane-entry";
import {useRegisterFilesPane} from "../src/components/panes/files-pane-entry";
import {useRegisterLinksPane} from "../src/components/panes/links-pane-entry";
import {useRegisterTerminalPane} from "../src/components/panes/terminal-pane-entry";
import {usePaneDefinitions} from "../src/components/panes/pane-registry";
import type {BackgroundTaskGroups} from "../src/lib/background-tasks";
import type {PaneKind} from "../src/lib/pane-layout";
import type {SessionFiles} from "../src/lib/session-files";
import type {SessionLine} from "../src/lib/transcript";

const harness = vi.hoisted(() => {
	let finish!: () => void;
	const ready = new Promise<void>((resolve) => {
		finish = resolve;
	});
	return {ready, finish, imports: [] as string[]};
});

vi.mock("../src/components/panes/files-pane", async () => {
	harness.imports.push("files");
	await harness.ready;
	return {FilesPane: ({sessionId}: {sessionId: string}) => <p>Files of {sessionId}</p>};
});

vi.mock("../src/components/panes/links-pane", async () => {
	harness.imports.push("links");
	await harness.ready;
	return {LinksPane: ({sessionId}: {sessionId: string}) => <p>Links of {sessionId}</p>};
});

vi.mock("../src/components/panes/background-tasks-pane", async () => {
	harness.imports.push("background-tasks");
	await harness.ready;
	return {
		BackgroundTasksList: ({sessionId}: {sessionId: string}) => <p>Background tasks of {sessionId}</p>,
	};
});

vi.mock("../src/components/panes/terminal-pane", async () => {
	harness.imports.push("terminal");
	await harness.ready;
	return {TerminalPane: ({sessionId}: {sessionId: string}) => <p>Terminal of {sessionId}</p>};
});

const JUMP_TARGET_WINDOW: JumpTargetWindow = {windowStartIndex: 0, requestMessageJump: () => {}};
const SESSION = "session-alice";
const NO_LINES: SessionLine[] = [];
const NO_BACKGROUND_TASKS: BackgroundTaskGroups = {running: [], finished: []};
const EMPTY_FILES: SessionFiles = {
	files: [],
	totalCount: 0,
	counts: {read: 0, editWrite: 0, bash: 0, grepGlob: 0, other: 0, userMessage: 0, agentMessage: 0, thinking: 0},
};

function Panes({shown}: {shown: PaneKind[]}) {
	useRegisterFilesPane({
		sessionId: SESSION,
		cwd: undefined,
		windowFiles: EMPTY_FILES,
		windowStartIndex: 0,
		jumpTargetWindow: JUMP_TARGET_WINDOW,
	});
	useRegisterLinksPane({
		sessionId: SESSION,
		lines: NO_LINES,
		windowStartIndex: 0,
		jumpTargetWindow: JUMP_TARGET_WINDOW,
	});
	useRegisterBackgroundTasksPane(SESSION, NO_BACKGROUND_TASKS, 0);
	useRegisterTerminalPane(SESSION, {livePane: true, interactive: false, shells: false});
	const definitions = usePaneDefinitions();
	return (
		<>
			{shown.map((kind) => (
				<section key={kind} aria-label={definitions.get(kind)?.title}>
					{definitions.get(kind)?.render({moveHandle: <button type="button">Move</button>, controls: null})}
				</section>
			))}
		</>
	);
}

function paneText(name: string) {
	return screen.getByRole("region", {name}).textContent;
}

afterEach(() => {
	cleanup();
});

describe("deferred Files, Links, Terminal and Background tasks panes", () => {
	it("register immediately, load their renderers only when shown, and keep the Files and Terminal headers while loading", async () => {
		const view = render(<Panes shown={[]} />);
		const registered = {imports: [...harness.imports]};
		view.rerender(<Panes shown={["files", "links", "terminal", "background-tasks"]} />);
		const loading = {
			files: paneText("Files"),
			links: paneText("Links"),
			terminal: paneText("Terminal"),
			backgroundTasks: paneText("Background tasks"),
		};
		act(() => {
			harness.finish();
		});
		await screen.findByText("Files of session-alice");
		await screen.findByText("Links of session-alice");
		await screen.findByText("Terminal of session-alice");
		await screen.findByText("Background tasks of session-alice");
		expect({
			registered,
			loading,
			loaded: {
				files: paneText("Files"),
				links: paneText("Links"),
				terminal: paneText("Terminal"),
				backgroundTasks: paneText("Background tasks"),
			},
			imports: harness.imports.toSorted((left, right) => left.localeCompare(right)),
		}).toStrictEqual({
			registered: {imports: []},
			loading: {
				files: "FilesMoveLoading files…",
				links: "Loading links…",
				terminal: "TerminalMoveLoading terminal…",
				backgroundTasks: "Loading background tasks…",
			},
			loaded: {
				files: "Files of session-alice",
				links: "Links of session-alice",
				terminal: "Terminal of session-alice",
				backgroundTasks: "Background tasks of session-alice",
			},
			imports: ["background-tasks", "files", "links", "terminal"],
		});
	});
});
