import type { MouseEvent } from "react";
import { CODEBLOCK_CLASS, CODEBLOCK_COPY_ATTR } from "./client-markdown";
import { CHECK_ICON_SVG, COPY_ICON_SVG } from "./icon-paths";
import { writeClipboardText } from "./clipboard";

/** How long the button shows the check glyph after a successful copy. */
const COPIED_FEEDBACK_MS = 1500;

/**
 * One delegated click handler for the copy buttons the markdown renderer emits
 * alongside every fenced code block. The rendered markdown is injected as raw
 * HTML, so the buttons cannot carry React handlers of their own; put this on the
 * container instead.
 */
export function handleCodeCopyClick(event: MouseEvent<HTMLElement>): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest(`[${CODEBLOCK_COPY_ATTR}]`);
  if (!(button instanceof HTMLElement)) return;

  const pre = button.closest(`.${CODEBLOCK_CLASS}`)?.querySelector("pre");
  if (!pre) return;

  void writeClipboardText(pre.textContent ?? "").then((copied) => {
    if (!copied) return;
    button.innerHTML = CHECK_ICON_SVG;
    setTimeout(() => {
      button.innerHTML = COPY_ICON_SVG;
    }, COPIED_FEEDBACK_MS);
  });
}
