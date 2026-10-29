import type {MouseEvent} from "react";

const HOVER_WITHIN = "data-hover-within";
const MARKED_SECTIONS = `.group\\/section[${HOVER_WITHIN}]`;

function containsNode(section: Element, node: EventTarget | null): boolean {
	return node instanceof Node && section.contains(node);
}

/**
 * Upstream `G4` (`C9`): marks the section under the pointer with `data-hover-within`, clearing every
 * other section so only one holds it. Driven by React `onMouseOver`/`onMouseOut`, which also reach the
 * section from content it portals out (a row menu); enter only marks for DOM descendants, so a portalled
 * mouseover leaves the mark as it is.
 */
function enterSection(event: MouseEvent<HTMLElement>): void {
	const section = event.currentTarget;
	if (!containsNode(section, event.target) || section.hasAttribute(HOVER_WITHIN)) return;
	for (const marked of section.ownerDocument.querySelectorAll(MARKED_SECTIONS)) {
		if (!containsNode(marked, event.target)) marked.removeAttribute(HOVER_WITHIN);
	}
	section.setAttribute(HOVER_WITHIN, "");
}

function leaveSection(event: MouseEvent<HTMLElement>): void {
	const section = event.currentTarget;
	if (section.hasAttribute(HOVER_WITHIN) && !containsNode(section, event.relatedTarget)) {
		section.removeAttribute(HOVER_WITHIN);
	}
}

/** Spread on a `group/section` element; its children style off `group-data-[hover-within]/section:`. */
export const sectionHoverWithinProps = {onMouseOver: enterSection, onMouseOut: leaveSection} as const;
