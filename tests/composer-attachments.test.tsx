// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import type {ComposerState} from "../src/lib/composer-state";
import type {LaunchOptions} from "../src/lib/launch-options";
import {takeContextChips} from "../src/lib/context-attach";
import {getShortcut} from "../src/lib/shortcuts/registry";

const MAC_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const SESSION = "session-alice";
const ATTACHMENTS = "/cache/claude-code-plans/attachments";

const CHIN: ComposerState = {
	mode: {id: "default", label: "Manual"},
	model: "Opus 5.5",
	modelId: "claude-opus-5-5",
	effort: {id: "high", label: "High"},
	usage: null,
};

type OnSend = (prompt: string, launchOptions: LaunchOptions) => void;

const uploads: string[] = [];

function mockUploads(respond: (file: File) => Response) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: string, init: RequestInit) => {
			const file = (init.body as FormData).get("file") as File;
			uploads.push(file.name);
			return respond(file);
		}),
	);
}

function savedAs(path: string) {
	return (file: File) => Response.json({path, name: file.name, mediaType: file.type, size: file.size}, {status: 201});
}

function renderComposer(chin?: ComposerState) {
	const onSend = vi.fn<OnSend>();
	render(<Composer variant="session" draftKey={SESSION} onSend={onSend} {...(chin === undefined ? {} : {chin})} />);
	return onSend;
}

function prompt(): HTMLTextAreaElement {
	return screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
}

function paste(init: {text?: string; files?: File[]}) {
	const files = init.files ?? [];
	return fireEvent.paste(prompt(), {
		clipboardData: {
			getData: (type: string) => (type === "text/plain" ? (init.text ?? "") : ""),
			files,
			types: files.length > 0 ? ["Files"] : ["text/plain"],
		},
	});
}

function chipNames(): string[] {
	const strip = screen.queryByRole("list", {name: "Attached context"});
	if (strip === null) return [];
	return within(strip)
		.getAllByRole("listitem")
		.map((item) => item.getAttribute("data-chip-label") ?? "");
}

const png = (name: string) => new File([new Uint8Array([1, 2, 3])], name, {type: "image/png"});

beforeEach(() => {
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
	Object.assign(URL, {createObjectURL: () => "blob:preview", revokeObjectURL: () => {}});
});

afterEach(() => {
	cleanup();
	takeContextChips(SESSION);
	localStorage.clear();
	uploads.length = 0;
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(URL, "createObjectURL");
	Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("Composer attachments", () => {
	it("turns a long paste into a Pasted text chip that is inlined ahead of the prompt on send", () => {
		const onSend = renderComposer();
		const long = Array.from({length: 41}, (_, i) => `line ${i + 1}`).join("\n");

		const notPrevented = paste({text: long});
		const chips = chipNames();
		const textAfterPaste = prompt().value;
		fireEvent.change(prompt(), {target: {value: "Summarize this"}});
		fireEvent.keyDown(prompt(), {key: "Enter"});

		expect({
			notPrevented,
			chips,
			textAfterPaste,
			sent: onSend.mock.calls,
			chipsAfterSend: chipNames(),
		}).toStrictEqual({
			notPrevented: false,
			chips: ["Pasted text · 41 lines"],
			textAfterPaste: "",
			sent: [[`${long}\n\nSummarize this`, {}]],
			chipsAfterSend: [],
		});
	});

	it("lets a short paste go into the prompt as usual", () => {
		renderComposer();

		const notPrevented = paste({text: "a short snippet"});

		expect({notPrevented, chips: chipNames()}).toStrictEqual({notPrevented: true, chips: []});
	});

	it("uploads a pasted image, shows a thumbnail chip, and puts its saved path in the prompt", async () => {
		mockUploads(savedAs(`${ATTACHMENTS}/0001.png`));
		const onSend = renderComposer();

		paste({files: [png("screenshot.png")]});
		const thumbnail = await screen.findByRole("img", {name: "screenshot.png"});
		fireEvent.change(prompt(), {target: {value: "Why is this red?"}});
		fireEvent.keyDown(prompt(), {key: "Enter"});

		expect({
			uploads,
			src: thumbnail.getAttribute("src"),
			sent: onSend.mock.calls,
		}).toStrictEqual({
			uploads: ["screenshot.png"],
			src: "blob:preview",
			sent: [[`${ATTACHMENTS}/0001.png\n\nWhy is this red?`, {}]],
		});
	});

	it("attaches an uploaded text file as an @ mention of its saved path", async () => {
		mockUploads(savedAs(`${ATTACHMENTS}/0002.md`));
		const onSend = renderComposer();

		paste({files: [new File(["# Notes"], "notes.md", {type: "text/markdown"})]});
		await waitFor(() => expect(chipNames()).toStrictEqual(["notes.md"]));
		fireEvent.keyDown(prompt(), {key: "Enter"});

		expect(onSend.mock.calls).toStrictEqual([[`@${ATTACHMENTS}/0002.md`, {}]]);
	});

	it("uploads files dropped on the card", async () => {
		mockUploads(savedAs(`${ATTACHMENTS}/0003.png`));
		renderComposer();
		const card = prompt().closest("[data-composer-card]")!;

		fireEvent.dragOver(card, {dataTransfer: {types: ["Files"], files: []}});
		const overlay = screen.queryByText("Drop files here") !== null;
		fireEvent.drop(card, {dataTransfer: {types: ["Files"], files: [png("dropped.png")]}});
		await screen.findByRole("img", {name: "dropped.png"});

		expect({
			overlay,
			overlayAfterDrop: screen.queryByText("Drop files here") !== null,
			uploads,
		}).toStrictEqual({
			overlay: true,
			overlayAfterDrop: false,
			uploads: ["dropped.png"],
		});
	});

	it("opens the file picker from ⌘U and from + Add files or photos, and uploads the picks", async () => {
		mockUploads(savedAs(`${ATTACHMENTS}/0004.png`));
		renderComposer(CHIN);
		const picker = screen.getByLabelText<HTMLInputElement>("Add files or photos");
		const clicks = vi.spyOn(picker, "click").mockImplementation(() => {});

		fireEvent.keyDown(prompt(), {key: "u", code: "KeyU", metaKey: true});
		fireEvent.click(screen.getByRole("button", {name: "Add"}));
		fireEvent.click(await screen.findByRole("menuitem", {name: /Add files or photos/}));
		fireEvent.change(picker, {target: {files: [png("picked.png")]}});
		await screen.findByRole("img", {name: "picked.png"});

		expect({
			clicks: clicks.mock.calls.length,
			uploads,
			enabled: getShortcut("add_files").enabled,
			accept: picker.accept,
		}).toStrictEqual({
			clicks: 2,
			uploads: ["picked.png"],
			enabled: true,
			accept: "image/*,text/*",
		});
	});

	it("reports a rejected upload without adding a chip", async () => {
		mockUploads(() => Response.json({error: "File is larger than 5 MB"}, {status: 413}));
		renderComposer();

		paste({files: [png("huge.png")]});
		const alert = await screen.findByRole("alert");

		expect({message: alert.textContent, chips: chipNames()}).toStrictEqual({
			message: "Couldn’t attach huge.png: File is larger than 5 MB",
			chips: [],
		});
	});
});
