// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {ToastContext, type ToastOptions} from "../src/components/toast-context";
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
const toasts = vi.fn<(options: ToastOptions) => void>();

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
			<ToastContext.Provider value={toasts}>
				<Composer
					variant="session"
					draftKey={SESSION}
					onSend={onSend}
					{...(chin === undefined ? {} : {chin})}
				/>
			</ToastContext.Provider>
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
	toasts.mockReset();
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
		const thumbnail = (await screen.findByRole("button", {name: "screenshot.png"})).querySelector("img")!;
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
		await screen.findByRole("button", {name: "dropped.png"});

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
		await screen.findByRole("button", {name: "picked.png"});

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
				"rounded-card-xs",
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
		const saved = await screen.findByRole("button", {name: "shot.png"});
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

	it("waits for a pending upload before sending, then sends its saved path with the prompt", async () => {
		const pending = deferUploads();
		const onSend = renderComposer();

		paste({files: [png("shot.png")]});
		fireEvent.change(prompt(), {target: {value: "Why?"}});
		fireEvent.keyDown(prompt(), {key: "Enter"});
		const whileWaiting = {sent: [...onSend.mock.calls], prompt: prompt().value};
		pending[0]!(savedAs(`${ATTACHMENTS}/0007.png`)(png("shot.png")));
		await waitFor(() => {
			expect(onSend).toHaveBeenCalled();
		});

		expect({whileWaiting, sent: onSend.mock.calls, prompt: prompt().value, chips: chipNames()}).toStrictEqual({
			whileWaiting: {sent: [], prompt: "Why?"},
			sent: [[`${ATTACHMENTS}/0007.png\n\nWhy?`, {}]],
			prompt: "",
			chips: [],
		});
	});

	it("abandons a waiting send when the prompt changes, keeping the chip", async () => {
		const pending = deferUploads();
		const onSend = renderComposer();

		paste({files: [png("shot.png")]});
		fireEvent.change(prompt(), {target: {value: "Why?"}});
		fireEvent.keyDown(prompt(), {key: "Enter"});
		fireEvent.change(prompt(), {target: {value: "Why not?"}});
		pending[0]!(savedAs(`${ATTACHMENTS}/0008.png`)(png("shot.png")));
		await screen.findByRole("button", {name: "shot.png"});
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});

		expect({sent: onSend.mock.calls, prompt: prompt().value, chips: chipNames()}).toStrictEqual({
			sent: [],
			prompt: "Why not?",
			chips: ["shot.png"],
		});
	});

	it("sends the prompt alone when the upload it waited for fails", async () => {
		const pending = deferUploads();
		const onSend = renderComposer();

		paste({files: [png("huge.png")]});
		fireEvent.change(prompt(), {target: {value: "Why?"}});
		fireEvent.keyDown(prompt(), {key: "Enter"});
		pending[0]!(Response.json({error: "File is larger than 5 MB"}, {status: 413}));
		await waitFor(() => {
			expect(onSend).toHaveBeenCalled();
		});

		expect({sent: onSend.mock.calls, toasts: toasts.mock.calls, chips: chipNames()}).toStrictEqual({
			sent: [["Why?", {}]],
			toasts: [[{kind: "error", message: "Failed to process image. You can try again."}]],
			chips: [],
		});
	});

	it("abandons a waiting send when the composer switches to another session", async () => {
		const pending = deferUploads();
		const onSend = vi.fn<OnSend>();
		const queryClient = new QueryClient();
		queryClient.setQueryData(customizeMcpServersQueryOptions.queryKey, []);
		const view = (draftKey: string) => (
			<QueryClientProvider client={queryClient}>
				<Composer variant="session" draftKey={draftKey} onSend={onSend} />
			</QueryClientProvider>
		);
		const {rerender} = render(view(SESSION));

		paste({files: [png("shot.png")]});
		fireEvent.change(prompt(), {target: {value: "Why?"}});
		fireEvent.keyDown(prompt(), {key: "Enter"});
		rerender(view("session-bob"));
		pending[0]!(savedAs(`${ATTACHMENTS}/0009.png`)(png("shot.png")));
		await waitFor(() => {
			expect(getContextChips(SESSION).map((chip) => chip.status)).toStrictEqual([undefined]);
		});
		await new Promise((resolve) => {
			setTimeout(resolve, 0);
		});

		expect({sent: onSend.mock.calls, chips: getContextChips(SESSION).map((chip) => chip.name)}).toStrictEqual({
			sent: [],
			chips: ["shot.png"],
		});
	});

	it("toasts upstream's image failure copy for a rejected image upload, removing its pending chip", async () => {
		mockUploads(() => Response.json({error: "File is larger than 5 MB"}, {status: 413}));
		renderComposer();

		paste({files: [png("huge.png")]});
		await waitFor(() => {
			expect(toasts).toHaveBeenCalled();
		});

		expect({toasts: toasts.mock.calls, chips: chipNames(), alert: screen.queryByRole("alert")}).toStrictEqual({
			toasts: [[{kind: "error", message: "Failed to process image. You can try again."}]],
			chips: [],
			alert: null,
		});
	});

	it("toasts upstream's file failure copy for a rejected non-image upload", async () => {
		mockUploads(() => Response.json({error: "Unsupported file type"}, {status: 415}));
		renderComposer();

		paste({files: [new File(["# notes"], "notes.md", {type: "text/markdown"})]});
		await waitFor(() => {
			expect(toasts).toHaveBeenCalled();
		});

		expect({toasts: toasts.mock.calls, chips: chipNames(), alert: screen.queryByRole("alert")}).toStrictEqual({
			toasts: [[{kind: "error", message: "Failed to upload notes.md. It won’t be attached."}]],
			chips: [],
			alert: null,
		});
	});
	it("caps a paste at 5 images, counting staged and pending ones, and warns once", () => {
		deferUploads();
		renderComposer();

		paste({files: [png("a.png"), png("b.png")]});
		paste({files: [png("c.png"), png("d.png"), png("e.png"), png("f.png")]});

		expect({uploads, toasts: toasts.mock.calls, chips: chipNames()}).toStrictEqual({
			uploads: ["a.png", "b.png", "c.png", "d.png", "e.png"],
			toasts: [[{kind: "warning", message: "Maximum of 5 images allowed."}]],
			chips: ["a.png", "b.png", "c.png", "d.png", "e.png"],
		});
	});

	it("does not count files toward the 5-image cap", () => {
		deferUploads();
		renderComposer();

		paste({files: ["a", "b", "c", "d", "e"].map((name) => png(`${name}.png`))});
		paste({files: [new File(["# notes"], "notes.md", {type: "text/markdown"})]});

		expect({uploads, toasts: toasts.mock.calls}).toStrictEqual({
			uploads: ["a.png", "b.png", "c.png", "d.png", "e.png", "notes.md"],
			toasts: [],
		});
	});

	it("drops an image over the size limit without uploading it and warns with the local limit", () => {
		deferUploads();
		renderComposer();

		const huge = new File([new Uint8Array(6 * 1024 * 1024)], "huge.png", {type: "image/png"});
		paste({files: [huge, png("small.png")]});

		expect({uploads, toasts: toasts.mock.calls, chips: chipNames()}).toStrictEqual({
			uploads: ["small.png"],
			toasts: [[{kind: "warning", message: "Some images were too large to attach. Maximum size is 5 MB."}]],
			chips: ["small.png"],
		});
	});
});
