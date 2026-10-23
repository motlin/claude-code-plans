// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {customizeMcpServersQueryOptions} from "../src/lib/api/customize";
import type {ComposerState} from "../src/lib/composer-state";
import type {LaunchOptions} from "../src/lib/launch-options";
import {getContextChips, removeContextChip, takeContextChips} from "../src/lib/context-attach";
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
			return Promise.resolve(respond(file));
		}),
	);
}

/** Holds each upload open until the test settles it. */
function deferUploads() {
	const pending: ((response: Response) => void)[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: string, init: RequestInit) => {
			uploads.push(((init.body as FormData).get("file") as File).name);
			return new Promise<Response>((resolve) => {
				pending.push(resolve);
			});
		}),
	);
	return pending;
}

function savedAs(path: string) {
	return (file: File) => Response.json({path, name: file.name, mediaType: file.type, size: file.size}, {status: 201});
}

function renderComposer(chin?: ComposerState) {
	const onSend = vi.fn<OnSend>();
	// The + menu's Connectors submenu reads the MCP server list.
	const queryClient = new QueryClient();
	queryClient.setQueryData(customizeMcpServersQueryOptions.queryKey, []);
	render(
		<QueryClientProvider client={queryClient}>
			<Composer variant="session" draftKey={SESSION} onSend={onSend} {...(chin === undefined ? {} : {chin})} />
		</QueryClientProvider>,
	);
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
	for (const chip of getContextChips(SESSION)) removeContextChip(SESSION, chip.id);
	localStorage.clear();
	uploads.length = 0;
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(URL, "createObjectURL");
	Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("Composer attachments", () => {
	it("keeps a long paste inline in the prompt with no attachment chip, as upstream does", () => {
		renderComposer();

		const notPrevented = paste({text: "x".repeat(3000)});

		expect({
			notPrevented,
			chips: chipNames(),
			attachedList: document.querySelector('[aria-label="Attached context"]'),
		}).toStrictEqual({notPrevented: true, chips: [], attachedList: null});
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
		await waitFor(() => {
			expect(document.querySelector("[data-state=pending]")).toBeNull();
		});
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

	it("shows a pending image tile while the upload runs, then swaps in the saved image", async () => {
		const pending = deferUploads();
		renderComposer();

		paste({files: [png("shot.png")]});
		const tile = document.querySelector("li[data-cds=MessageAttachmentsImage]")!;
		const skeleton = tile.querySelector("[data-cds=Skeleton]")!;
		const img = tile.querySelector("img")!;
		const before = {
			state: tile.getAttribute("data-state"),
			busy: tile.getAttribute("aria-busy"),
			skeletonRole: skeleton.getAttribute("role"),
			skeletonClasses: [
				"absolute",
				"inset-0",
				"size-full",
				"rounded-card",
				"overflow-hidden",
				"bg-[var(--skeleton-base)]",
				"motion-reduce:after:hidden",
			].filter((name) => !skeleton.classList.contains(name)),
			skeletonRelative: skeleton.classList.contains("relative"),
			src: img.getAttribute("src"),
			alt: img.getAttribute("alt"),
			opacity: [...img.classList].filter((name) => name.startsWith("opacity-")),
			status: [...tile.querySelectorAll(":scope > [role=status].sr-only")].map((node) => node.textContent),
			cardLink: tile.querySelector("[role=button]"),
		};
		fireEvent.load(img);
		const loadedOpacity = [...img.classList].filter((name) => name.startsWith("opacity-"));
		pending[0]!(savedAs(`${ATTACHMENTS}/0005.png`)(png("shot.png")));
		const saved = await screen.findByRole("img", {name: "shot.png"});
		const settled = saved.closest("li")!;

		expect({
			before,
			loadedOpacity,
			after: {
				state: settled.getAttribute("data-state"),
				busy: settled.getAttribute("aria-busy"),
				skeleton: settled.querySelector("[data-cds=Skeleton]"),
			},
			chips: takeContextChips(SESSION).map(({id: _id, ...rest}) => rest),
		}).toStrictEqual({
			before: {
				state: "pending",
				busy: "true",
				skeletonRole: "status",
				skeletonClasses: [],
				skeletonRelative: false,
				src: "blob:preview",
				alt: "",
				opacity: ["opacity-0"],
				status: ["Processing image"],
				cardLink: null,
			},
			loadedOpacity: ["opacity-50"],
			after: {state: null, busy: null, skeleton: null},
			chips: [{kind: "image", path: `${ATTACHMENTS}/0005.png`, name: "shot.png", previewUrl: "blob:preview"}],
		});
	});

	it("shows a pending file tile while a non-image upload runs", () => {
		deferUploads();
		renderComposer();

		paste({files: [new File(["# Notes"], "notes.md", {type: "text/markdown"})]});
		const tile = document.querySelector("li[data-cds=MessageAttachmentsFile]")!;

		expect({
			chips: chipNames(),
			state: tile.getAttribute("data-state"),
			busy: tile.getAttribute("aria-busy"),
			skeleton: tile.querySelector("[data-cds=Skeleton]")?.getAttribute("role"),
			status: [...tile.querySelectorAll(":scope > [role=status].sr-only")].map((node) => node.textContent),
		}).toStrictEqual({
			chips: ["notes.md"],
			state: "pending",
			busy: "true",
			skeleton: "status",
			status: ["Uploading file"],
		});
	});

	it("adds nothing when a pending chip is removed before its upload resolves", async () => {
		const pending = deferUploads();
		renderComposer();

		paste({files: [png("gone.png")]});
		fireEvent.click(screen.getByRole("button", {name: "Remove gone.png"}));
		pending[0]!(savedAs(`${ATTACHMENTS}/0006.png`)(png("gone.png")));
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});

		expect(chipNames()).toStrictEqual([]);
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
