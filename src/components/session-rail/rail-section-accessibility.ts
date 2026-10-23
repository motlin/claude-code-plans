import type {Announcements, ScreenReaderInstructions, UniqueIdentifier} from "@dnd-kit/core";

import {RAIL_SECTION_TITLES, RailSectionIdSchema, type RailSectionId} from "../../lib/session-rail-store";

/** Upstream's screen-reader strings for picking up and moving a rail section. */
export function railSectionAccessibility(shownIds: readonly RailSectionId[]): {
	screenReaderInstructions: ScreenReaderInstructions;
	announcements: Announcements;
} {
	const name = (id: UniqueIdentifier) => {
		const parsed = RailSectionIdSchema.safeParse(id);
		return parsed.success ? RAIL_SECTION_TITLES[parsed.data] : String(id);
	};
	const where = (id: UniqueIdentifier) =>
		`section ${shownIds.findIndex((each) => each === id) + 1} of ${shownIds.length}`;
	return {
		screenReaderInstructions: {
			draggable:
				"To pick up a section, press Space or Enter. While it is picked up, press the up or down arrow key to move it, Space or Enter to drop it, or Escape to cancel.",
		},
		announcements: {
			onDragStart: ({active}) => `Picked up ${name(active.id)}. It is ${where(active.id)}.`,
			onDragOver: ({active, over}) => (over ? `${name(active.id)} is now ${where(over.id)}.` : undefined),
			onDragEnd: ({active, over}) => `${name(active.id)} dropped at ${where(over ? over.id : active.id)}.`,
			onDragCancel: ({active}) => `Moving ${name(active.id)} was cancelled.`,
		},
	};
}
