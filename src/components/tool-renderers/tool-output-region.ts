/**
 * Upstream's labelled tool-body scroll regions: a focusable named group so the
 * capped body can be scrolled from the keyboard and announced by screen readers.
 */
export const TOOL_OUTPUT_REGION = {role: "group", "aria-label": "Tool output", tabIndex: 0} as const;
