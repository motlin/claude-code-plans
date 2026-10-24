import {describe, it, expect, vi, beforeEach, afterEach} from "vite-plus/test";
import {writeClipboardText} from "../src/lib/clipboard";

class StubClipboardItem {
	constructor(readonly items: Record<string, Blob>) {}
}

describe("writeClipboardText", () => {
	let originalClipboard: Clipboard;
	let originalDocument: typeof globalThis.document;

	beforeEach(() => {
		originalClipboard = navigator.clipboard;
		originalDocument = globalThis.document;
	});

	afterEach(() => {
		Object.defineProperty(navigator, "clipboard", {
			value: originalClipboard,
			writable: true,
			configurable: true,
		});
		globalThis.document = originalDocument;
		vi.restoreAllMocks();
	});

	it("uses navigator.clipboard.writeText when available", async () => {
		const writeText = vi.fn<Clipboard["writeText"]>().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {
			value: {writeText},
			writable: true,
			configurable: true,
		});

		const result = await writeClipboardText("hello");
		expect(result).toBe(true);
		expect(writeText).toHaveBeenCalledWith("hello");
	});

	it("writes text/plain and text/html as one ClipboardItem when given html", async () => {
		vi.stubGlobal("ClipboardItem", StubClipboardItem);
		const write = vi.fn<(items: StubClipboardItem[]) => Promise<void>>().mockResolvedValue(undefined);
		const writeText = vi.fn<Clipboard["writeText"]>().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {value: {write, writeText}, writable: true, configurable: true});

		const result = await writeClipboardText("hi", "<p>hi</p>");
		const item = write.mock.calls[0]?.[0][0];

		expect({
			result,
			writeText: writeText.mock.calls,
			plain: await item?.items["text/plain"]?.text(),
			html: await item?.items["text/html"]?.text(),
			types: Object.keys(item?.items ?? {}),
		}).toStrictEqual({
			result: true,
			writeText: [],
			plain: "hi",
			html: "<p>hi</p>",
			types: ["text/plain", "text/html"],
		});
		vi.unstubAllGlobals();
	});

	it("falls back to plain text when the rich write rejects", async () => {
		vi.stubGlobal("ClipboardItem", StubClipboardItem);
		const write = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("Not allowed"));
		const writeText = vi.fn<Clipboard["writeText"]>().mockResolvedValue(undefined);
		Object.defineProperty(navigator, "clipboard", {value: {write, writeText}, writable: true, configurable: true});

		const result = await writeClipboardText("hi", "<p>hi</p>");

		expect({result, writeText: writeText.mock.calls}).toStrictEqual({result: true, writeText: [["hi"]]});
		vi.unstubAllGlobals();
	});

	it("falls back to execCommand when clipboard API rejects", async () => {
		const writeText = vi.fn<Clipboard["writeText"]>().mockRejectedValue(new Error("Not allowed"));
		Object.defineProperty(navigator, "clipboard", {
			value: {writeText},
			writable: true,
			configurable: true,
		});

		const mockTextarea = {value: "", style: {}, select: vi.fn<() => void>()};
		const mockDocument = {
			createElement: vi.fn<(tagName: string) => typeof mockTextarea>().mockReturnValue(mockTextarea),
			body: {
				appendChild: vi.fn<(node: Node) => void>(),
				removeChild: vi.fn<(node: Node) => void>(),
			},
			execCommand: vi.fn<(commandId: string) => boolean>().mockReturnValue(true),
		};
		// @ts-expect-error partial mock
		globalThis.document = mockDocument;

		const result = await writeClipboardText("fallback text");
		expect(result).toBe(true);
		expect(mockDocument.execCommand).toHaveBeenCalledWith("copy");
		expect(mockTextarea.value).toBe("fallback text");
		expect(mockTextarea.select).toHaveBeenCalled();
	});

	it("falls back to execCommand when clipboard API is undefined", async () => {
		Object.defineProperty(navigator, "clipboard", {
			value: undefined,
			writable: true,
			configurable: true,
		});

		const mockTextarea = {value: "", style: {}, select: vi.fn<() => void>()};
		const mockDocument = {
			createElement: vi.fn<(tagName: string) => typeof mockTextarea>().mockReturnValue(mockTextarea),
			body: {
				appendChild: vi.fn<(node: Node) => void>(),
				removeChild: vi.fn<(node: Node) => void>(),
			},
			execCommand: vi.fn<(commandId: string) => boolean>().mockReturnValue(true),
		};
		// @ts-expect-error partial mock
		globalThis.document = mockDocument;

		const result = await writeClipboardText("no clipboard");
		expect(result).toBe(true);
		expect(mockDocument.execCommand).toHaveBeenCalledWith("copy");
	});

	it("returns false when both methods fail", async () => {
		Object.defineProperty(navigator, "clipboard", {
			value: undefined,
			writable: true,
			configurable: true,
		});

		const mockTextarea = {value: "", style: {}, select: vi.fn<() => void>()};
		const mockDocument = {
			createElement: vi.fn<(tagName: string) => typeof mockTextarea>().mockReturnValue(mockTextarea),
			body: {
				appendChild: vi.fn<(node: Node) => void>(),
				removeChild: vi.fn<(node: Node) => void>(),
			},
			execCommand: vi.fn<(commandId: string) => boolean>().mockReturnValue(false),
		};
		// @ts-expect-error partial mock
		globalThis.document = mockDocument;

		const result = await writeClipboardText("will fail");
		expect(result).toBe(false);
	});

	it("returns false when execCommand throws", async () => {
		Object.defineProperty(navigator, "clipboard", {
			value: undefined,
			writable: true,
			configurable: true,
		});

		const mockDocument = {
			createElement: vi.fn<(tagName: string) => never>().mockImplementation(() => {
				throw new Error("DOM not available");
			}),
			body: {
				appendChild: vi.fn<(node: Node) => void>(),
				removeChild: vi.fn<(node: Node) => void>(),
			},
			execCommand: vi.fn<(commandId: string) => boolean>(),
		};
		// @ts-expect-error partial mock
		globalThis.document = mockDocument;

		const result = await writeClipboardText("will fail");
		expect(result).toBe(false);
	});
});
