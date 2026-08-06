// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  extractInlineImagePaths,
  InlinePathImages,
  isPathInsideAllowedImageRoot,
  SESSION_IMAGE_CLASS_NAME,
} from "../src/components/inline-path-images";
import { SessionChat } from "../src/components/session-chat";
import type { SessionLine } from "../src/lib/sessions";

vi.mock("../src/components/settings-provider", () => ({
  useSettings: () => ({ settings: { showDebug: false } }),
}));
vi.mock("../src/lib/hmr-persist", () => ({
  hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => ({
  useClaudeEvents: () => ({ failedTools: new Map() }),
}));

const ALLOWED_ROOT = "/tmp/test/images";

beforeEach(() => {
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function describeImages(): Array<{
  alt: string | null;
  anchorClassName: string;
  className: string;
  href: string | null;
  loading: string | null;
  rel: string | null;
  src: string | null;
  target: string | null;
}> {
  return screen.queryAllByRole("img").map((image) => {
    const anchor = image.closest("a");
    if (!(anchor instanceof HTMLAnchorElement)) throw new Error("Expected image link");
    return {
      alt: image.getAttribute("alt"),
      anchorClassName: anchor.className,
      className: image.className,
      href: anchor.getAttribute("href"),
      loading: image.getAttribute("loading"),
      rel: anchor.getAttribute("rel"),
      src: image.getAttribute("src"),
      target: anchor.getAttribute("target"),
    };
  });
}

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
    render(<InlinePathImages text={text} allowedRoots={[ALLOWED_ROOT]} />);

    expect({
      extractedPaths: extractInlineImagePaths(text),
      images: describeImages(),
    }).toStrictEqual({
      extractedPaths: [],
      images: [],
    });
  });

  it("resets the module-level regular expression before every scan", () => {
    const text = "/tmp/test/images/alice.png /tmp/test/images/bob.webp";
    const expected = ["/tmp/test/images/alice.png", "/tmp/test/images/bob.webp"];

    expect([extractInlineImagePaths(text), extractInlineImagePaths(text)]).toStrictEqual([
      expected,
      expected,
    ]);
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

  it("renders only allowed paths with encoded URLs and safe image-link attributes", () => {
    render(
      <InlinePathImages
        text={
          "Open /tmp/test/images/alice+detail.png, @/tmp/test/images/bob.gif, /tmp/test/images/alice+detail.png again, and /tmp/test/outside/charlie.webp"
        }
        allowedRoots={[ALLOWED_ROOT]}
      />,
    );

    expect(describeImages()).toStrictEqual([
      {
        alt: "Referenced image /tmp/test/images/alice+detail.png",
        anchorClassName: "cursor-zoom-in",
        className: SESSION_IMAGE_CLASS_NAME,
        href: "/api/image?path=%2Ftmp%2Ftest%2Fimages%2Falice%2Bdetail.png",
        loading: "lazy",
        rel: "noopener noreferrer",
        src: "/api/image?path=%2Ftmp%2Ftest%2Fimages%2Falice%2Bdetail.png",
        target: "_blank",
      },
      {
        alt: "Referenced image /tmp/test/images/bob.gif",
        anchorClassName: "cursor-zoom-in",
        className: SESSION_IMAGE_CLASS_NAME,
        href: "/api/image?path=%2Ftmp%2Ftest%2Fimages%2Fbob.gif",
        loading: "lazy",
        rel: "noopener noreferrer",
        src: "/api/image?path=%2Ftmp%2Ftest%2Fimages%2Fbob.gif",
        target: "_blank",
      },
    ]);
  });

  it("hides an image after the byte endpoint reports an error", () => {
    render(<InlinePathImages text="/tmp/test/images/alice.png" allowedRoots={[ALLOWED_ROOT]} />);
    const image = screen.getByRole("img");

    fireEvent.error(image);

    expect(image.style.display).toBe("none");
  });
});

describe("SessionChat integration", () => {
  it("preserves user path text, appends inline media, matches embedded styling, and ignores assistant paths", () => {
    const userText = "Review /tmp/test/images/alice.png";
    const assistantText = "Generated /tmp/test/images/bob.png";
    const lines: SessionLine[] = [
      {
        type: "user",
        uuid: "user-record-100",
        lineIndex: 0,
        message: {
          role: "user",
          content: [
            { type: "text", text: userText },
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "ZmFrZQ==" },
            },
          ],
        },
      },
      {
        type: "assistant",
        uuid: "assistant-record-100",
        lineIndex: 1,
        message: { role: "assistant", content: [{ type: "text", text: assistantText }] },
      },
    ];

    const { container } = render(
      <SessionChat
        sessionId="session-100"
        lines={lines}
        toolResultMap={new Map()}
        allowedImageRoots={[ALLOWED_ROOT]}
      />,
    );

    const images = screen.getAllByRole("img");
    expect({
      articleText: Array.from(container.querySelectorAll("article"), (article) =>
        article.textContent?.trim(),
      ),
      images: images.map((image) => ({
        alt: image.getAttribute("alt"),
        className: image.className,
        insideUserBubble: image.closest(".user-message-bubble") !== null,
      })),
    }).toStrictEqual({
      articleText: [userText, assistantText],
      images: [
        {
          alt: "Session image",
          className: SESSION_IMAGE_CLASS_NAME,
          insideUserBubble: false,
        },
        {
          alt: `Referenced image ${ALLOWED_ROOT}/alice.png`,
          className: SESSION_IMAGE_CLASS_NAME,
          insideUserBubble: false,
        },
      ],
    });
  });
});
