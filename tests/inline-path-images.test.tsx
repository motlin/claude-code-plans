// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {inlinePathImages} from "../src/components/inline-path-images";
import {extractInlineImagePaths, isPathInsideAllowedImageRoot} from "../src/components/inline-image-paths";
import {SessionChat} from "../src/components/session-chat";
import type {SessionLine} from "../src/lib/sessions";

vi.mock("../src/components/settings-context", () => ({
	useSettings: () => ({
		settings: {showDebug: false, codeThemeLight: "claude-light", codeThemeDark: "github-dark"},
	}),
}));
vi.mock("../src/lib/hmr-persist", () => ({
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
	useClaudeEvents: () => ({failedTools: new Map()}),
}));

const ALLOWED_ROOT = "/tmp/test/images";

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn(() => 1),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("inline path extraction", () => {
	it("extracts multiple absolute image paths, removes @ sigils, and deduplicates in first-use order", () => {
		const text =
			"Compare @/tmp/test/images/alice.png with /tmp/test/images/bob.JPEG and /tmp/test/images/alice.png";

		expect(extractInlineImagePaths(text)).toStrictEqual([
			"/tmp/test/images/alice.png",
			"/tmp/test/images/bob.JPEG",
		]);
	});

	it("ignores relative paths and unsupported extensions", () => {
		const text = "Compare images/alice.png and /tmp/test/images/notes.txt";

		expect({
			extractedPaths: extractInlineImagePaths(text),
			images: inlinePathImages(text, [ALLOWED_ROOT]),
		}).toStrictEqual({extractedPaths: [], images: []});
	});

	it("resets the module-level regular expression before every scan", () => {
		const text = "/tmp/test/images/alice.png /tmp/test/images/bob.webp";
		const expected = ["/tmp/test/images/alice.png", "/tmp/test/images/bob.webp"];

		expect([extractInlineImagePaths(text), extractInlineImagePaths(text)]).toStrictEqual([expected, expected]);
	});
});

describe("client-side image root filtering", () => {
	it("suppresses paths clearly outside configured roots without resolving symlinks client-side", () => {
		const cases = [
			"/tmp/test/images/alice.png",
			"/tmp/test/images-link/alice.png",
			"/tmp/test/images/../outside/alice.png",
			"/tmp/test/images/symlink/alice.png",
			"tmp/test/images/alice.png",
		];

		expect(cases.map((path) => isPathInsideAllowedImageRoot(path, [ALLOWED_ROOT]))).toStrictEqual([
			true,
			false,
			false,
			true,
			false,
		]);
	});

	it("attaches only allowed paths, once each, with encoded byte URLs", () => {
		expect(
			inlinePathImages(
				"Open /tmp/test/images/alice+detail.png, @/tmp/test/images/bob.gif, /tmp/test/images/alice+detail.png again, and /tmp/test/outside/charlie.webp",
				[ALLOWED_ROOT],
			),
		).toStrictEqual([
			{
				key: "path:/tmp/test/images/alice+detail.png",
				src: "/api/image?path=%2Ftmp%2Ftest%2Fimages%2Falice%2Bdetail.png",
				label: "Referenced file /tmp/test/images/alice+detail.png",
			},
			{
				key: "path:/tmp/test/images/bob.gif",
				src: "/api/image?path=%2Ftmp%2Ftest%2Fimages%2Fbob.gif",
				label: "Referenced file /tmp/test/images/bob.gif",
			},
		]);
	});
});

describe("SessionChat integration", () => {
	function chatWith(content: unknown[]) {
		const lines: SessionLine[] = [
			{type: "user", uuid: "user-record-100", lineIndex: 0, message: {role: "user", content}},
			{
				type: "assistant",
				uuid: "assistant-record-100",
				lineIndex: 1,
				message: {role: "assistant", content: [{type: "text", text: "Generated /tmp/test/images/bob.png"}]},
			},
		] as SessionLine[];
		return render(
			<SessionChat
				sessionId="session-100"
				lines={lines}
				toolResultMap={new Map()}
				allowedImageRoots={[ALLOWED_ROOT]}
				shouldScrollToEnd={false}
			/>,
		).container;
	}
	const pasted = {type: "image", source: {type: "base64", media_type: "image/png", data: "ZmFrZQ=="}};

	it("draws a message's pasted and referenced images as upstream's tile strip above the bubble, ignoring assistant paths", () => {
		const container = chatWith([{type: "text", text: "Review /tmp/test/images/alice.png"}, pasted]);
		const strip = container.querySelector("[data-attachments]");
		const bubble = container.querySelector(".user-message-bubble");

		expect({
			strip: strip?.className,
			aboveBubble:
				strip !== null &&
				bubble !== null &&
				Boolean(strip.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING),
			tiles: [...(strip?.querySelectorAll("[data-attachment-tile]") ?? [])].map((tile) => ({
				className: tile.className,
				control: tile.querySelector("[role=button]")?.getAttribute("aria-label"),
				src: tile.querySelector("img")?.getAttribute("src"),
				alt: tile.querySelector("img")?.getAttribute("alt"),
			})),
			allImages: container.querySelectorAll("img").length,
		}).toStrictEqual({
			strip: "attachment-strip",
			aboveBubble: true,
			tiles: [
				{
					className: "attachment-tile",
					control: "Open Attached image",
					src: "data:image/png;base64,ZmFrZQ==",
					alt: "",
				},
				{
					className: "attachment-tile",
					control: `Open Referenced file ${ALLOWED_ROOT}/alice.png`,
					src: "/api/image?path=%2Ftmp%2Ftest%2Fimages%2Falice.png",
					alt: "",
				},
			],
			allImages: 2,
		});
	});

	it("opens a tile in upstream's carousel viewer, steps through the message's images, and closes", async () => {
		const container = chatWith([{type: "text", text: "Review /tmp/test/images/alice.png"}, pasted]);
		fireEvent.click(container.querySelectorAll("[data-attachment-tile] [role=button]")[0]!);
		const viewer = await screen.findByRole("dialog", {name: "Image preview"});
		const shown = () => ({
			image: viewer.querySelector("[data-viewer-slide]:not([aria-hidden=true]) img")?.getAttribute("alt"),
			slides: viewer.querySelectorAll("[data-viewer-slide]").length,
			count: viewer.textContent.match(/\d+ of \d+/)?.[0],
		});
		const first = shown();
		fireEvent.click(screen.getByRole("button", {name: "Next image"}));
		const second = shown();
		fireEvent.click(screen.getByRole("button", {name: "Close"}));

		await waitFor(() => {
			expect(screen.queryByRole("dialog", {name: "Image preview"})).toBeNull();
		});
		expect({first, second}).toStrictEqual({
			first: {image: "Attached image", slides: 2, count: "1 of 2"},
			second: {image: `Referenced file ${ALLOWED_ROOT}/alice.png`, slides: 2, count: "2 of 2"},
		});
	});
});
