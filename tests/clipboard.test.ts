import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { writeClipboardText } from "../src/lib/clipboard";

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
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const result = await writeClipboardText("hello");
    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when clipboard API rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Not allowed"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const mockTextarea = { value: "", style: {}, select: vi.fn() };
    const mockDocument = {
      createElement: vi.fn().mockReturnValue(mockTextarea),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      execCommand: vi.fn().mockReturnValue(true),
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

    const mockTextarea = { value: "", style: {}, select: vi.fn() };
    const mockDocument = {
      createElement: vi.fn().mockReturnValue(mockTextarea),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      execCommand: vi.fn().mockReturnValue(true),
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

    const mockTextarea = { value: "", style: {}, select: vi.fn() };
    const mockDocument = {
      createElement: vi.fn().mockReturnValue(mockTextarea),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      execCommand: vi.fn().mockReturnValue(false),
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
      createElement: vi.fn().mockImplementation(() => {
        throw new Error("DOM not available");
      }),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      execCommand: vi.fn(),
    };
    // @ts-expect-error partial mock
    globalThis.document = mockDocument;

    const result = await writeClipboardText("will fail");
    expect(result).toBe(false);
  });
});
