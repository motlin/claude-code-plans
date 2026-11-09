import type {MouseEvent} from "react";
import {CODEBLOCK_CLASS, CODEBLOCK_COPY_ATTR, SECRET_RAW_ATTR, SECRET_REVEAL_ATTR} from "./client-markdown";
import {secretToggleLabel} from "./secret-mask";
import {CHECK_ICON_SVG, COPY_ICON_SVG, EYE_ICON_SVG, EYE_SLASH_ICON_SVG} from "./icon-paths";
import {writeClipboardText} from "./clipboard";

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
	if (handleSecretRevealClick(event)) return;
	const button = target.closest(`[${CODEBLOCK_COPY_ATTR}]`);
	if (!(button instanceof HTMLElement)) return;

	const pre = button.closest(`.${CODEBLOCK_CLASS}`)?.querySelector("pre");
	if (!pre) return;

	void writeClipboardText(pre.textContent).then((copied) => {
		if (!copied) return;
		button.innerHTML = CHECK_ICON_SVG;
		setTimeout(() => {
			button.innerHTML = COPY_ICON_SVG;
		}, COPIED_FEEDBACK_MS);
	});
}

/** Swap the nodes a secret template stands in for with the template's content. */
function swapWithTemplate(shown: readonly ChildNode[], template: HTMLTemplateElement): void {
	const hidden = [...template.content.childNodes];
	const anchor = shown[0];
	if (anchor === undefined) return;
	anchor.before(...hidden);
	template.content.replaceChildren(...shown);
}

/**
 * The delegated half of upstream's secret reveal toggles: the fence's "Reveal N secrets" button
 * (cb557955f `D`) and inline code's per-secret cloak button (`v`). Each click swaps the masked markup
 * with the raw markup kept in a sibling `<template>`, so the raw value is never in the rendered DOM
 * while masked; state lives in the DOM only and a re-render masks again. Returns whether it handled
 * the click.
 */
function handleSecretRevealClick(event: MouseEvent<HTMLElement>): boolean {
	const target = event.target;
	if (!(target instanceof Element)) return false;

	const blockButton = target.closest(`[${SECRET_REVEAL_ATTR}]`);
	if (blockButton instanceof HTMLElement) {
		const block = blockButton.closest(`.${CODEBLOCK_CLASS}`);
		const pre = block?.querySelector(":scope > pre");
		const template = block?.querySelector(`:scope > template[${SECRET_RAW_ATTR}]`);
		if (!pre || !(template instanceof HTMLTemplateElement)) return true;
		swapWithTemplate([pre], template);
		const revealed = blockButton.getAttribute("aria-pressed") !== "true";
		const count = Number(/\d+/.exec(blockButton.getAttribute("aria-label") ?? "")?.[0] ?? "1");
		const label = secretToggleLabel(count, revealed);
		blockButton.setAttribute("aria-pressed", String(revealed));
		blockButton.setAttribute("aria-label", label);
		blockButton.setAttribute("data-tooltip", label);
		blockButton.innerHTML = revealed ? EYE_SLASH_ICON_SVG : EYE_ICON_SVG;
		return true;
	}

	const cloak = target.closest("[data-redacted-secret]");
	const cloakButton = target.closest("button");
	if (cloak === null || cloakButton === null || !cloak.contains(cloakButton)) return false;
	event.stopPropagation();
	const value = cloak.querySelector(":scope > .break-all");
	const template = value?.querySelector(`:scope > template[${SECRET_RAW_ATTR}]`);
	if (!value || !(template instanceof HTMLTemplateElement)) return true;
	swapWithTemplate(
		[...value.childNodes].filter((node) => node !== template),
		template,
	);
	const revealed = cloakButton.getAttribute("aria-pressed") !== "true";
	const label = (cloakButton.getAttribute("aria-label") ?? "").replace(/^(?:Reveal|Hide) /, "");
	cloakButton.setAttribute("aria-pressed", String(revealed));
	cloakButton.setAttribute("aria-label", `${revealed ? "Hide" : "Reveal"} ${label}`);
	cloakButton.innerHTML = revealed ? EYE_SLASH_ICON_SVG : EYE_ICON_SVG;
	return true;
}
