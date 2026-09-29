// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { SessionStateIcon } from "../src/components/status-dot";
import { sessionStateKind } from "../src/lib/session-state";

afterEach(cleanup);

const DOT_WRAPPER = "flex min-h-3.5 min-w-3.5 shrink-0 items-center justify-center";

function markup(element: React.ReactElement): string {
  return render(element).container.innerHTML;
}

describe("SessionStateIcon", () => {
  it("renders awaiting as an amber status dot", () => {
    expect(markup(<SessionStateIcon kind="awaiting" />)).toBe(
      `<span role="status" aria-label="Awaiting input" class="${DOT_WRAPPER}"><span class="status-dot" data-kind="awaiting"></span></span>`,
    );
  });

  it("renders running as a blinking status dot", () => {
    expect(markup(<SessionStateIcon kind="running" />)).toBe(
      `<span role="status" aria-label="Running" class="${DOT_WRAPPER}"><span class="status-dot" data-kind="running"></span></span>`,
    );
  });

  it("renders ready as an accent status dot", () => {
    expect(markup(<SessionStateIcon kind="ready" />)).toBe(
      `<span role="status" aria-label="Ready" class="${DOT_WRAPPER}"><span class="status-dot" data-kind="ready"></span></span>`,
    );
  });

  it("renders error as a danger status dot", () => {
    expect(markup(<SessionStateIcon kind="error" />)).toBe(
      `<span role="status" aria-label="Error" class="${DOT_WRAPPER}"><span class="status-dot" data-kind="error"></span></span>`,
    );
  });

  it("renders idle as a hollow muted ring", () => {
    expect(markup(<SessionStateIcon kind="idle" />)).toBe(
      `<span role="img" aria-label="Idle" class="${DOT_WRAPPER}"><span aria-hidden="true" class="block size-[6px] rounded-full border border-current text-ink-muted opacity-50"></span></span>`,
    );
  });

  it("renders pr as a git-state coloured pull-request glyph labelled with number and state", () => {
    const { container } = render(<SessionStateIcon kind="pr" pr={{ number: 6, state: "draft" }} />);
    const wrapper = container.firstElementChild;
    const glyph = wrapper?.firstElementChild;
    expect({
      children: container.children.length,
      tag: wrapper?.tagName,
      role: wrapper?.getAttribute("role"),
      label: wrapper?.getAttribute("aria-label"),
      className: wrapper?.getAttribute("class"),
      glyphTag: glyph?.tagName,
      glyphHidden: glyph?.getAttribute("aria-hidden"),
      glyphCds: glyph?.getAttribute("data-cds"),
      glyphStyle: glyph?.getAttribute("style"),
      glyphSize: [glyph?.getAttribute("width"), glyph?.getAttribute("height")],
    }).toStrictEqual({
      children: 1,
      tag: "SPAN",
      role: "img",
      label: "#6 · Draft",
      className: "flex size-5 shrink-0 items-center justify-center",
      glyphTag: "svg",
      glyphHidden: "true",
      glyphCds: "Icon",
      glyphStyle: "color: var(--color-git-draft);",
      glyphSize: ["14", "14"],
    });
  });

  it("lets the caller override the accessible label", () => {
    expect(markup(<SessionStateIcon kind="running" label="Working" />)).toBe(
      `<span role="status" aria-label="Working" class="${DOT_WRAPPER}"><span class="status-dot" data-kind="running"></span></span>`,
    );
  });
});

describe("sessionStateKind", () => {
  it("maps each local display state to an upstream icon kind", () => {
    expect(
      (["waiting", "working", "review", "idle", "unknown"] as const).map((state) => [
        state,
        sessionStateKind(state),
      ]),
    ).toStrictEqual([
      ["waiting", "awaiting"],
      ["working", "running"],
      ["review", "ready"],
      ["idle", "idle"],
      ["unknown", "idle"],
    ]);
  });
});
