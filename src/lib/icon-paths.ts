/**
 * SVG geometry shared between React icon components and the HTML strings the
 * markdown renderer emits, so both draw the same upstream icon.
 */

/** 12x12 viewBox, filled. */
export const COPY_ICON_PATH =
  "M7.42584 5.08148C7.42584 4.80533 7.20199 4.58148 6.92584 4.58148H2.67584C2.3997 4.58148 2.17584 4.80534 2.17584 5.08148V9.33148C2.17584 9.60763 2.39969 9.83148 2.67584 9.83148H6.92584C7.202 9.83148 7.42584 9.60764 7.42584 9.33148V5.08148ZM8.42584 7.83636H8.92584C9.202 7.83636 9.42584 7.61252 9.42584 7.33636V3.08148C9.42584 2.80533 9.20199 2.58148 8.92584 2.58148H4.67584C4.3997 2.58148 4.17584 2.80534 4.17584 3.08148V3.58148H6.92584C7.75429 3.58148 8.42584 4.25306 8.42584 5.08148V7.83636ZM10.4258 7.33636C10.4258 8.16481 9.75428 8.83636 8.92584 8.83636H8.42584V9.33148C8.42584 10.1599 7.75428 10.8315 6.92584 10.8315H2.67584C1.84742 10.8315 1.17584 10.1599 1.17584 9.33148V5.08148C1.17584 4.25305 1.84741 3.58148 2.67584 3.58148H3.17584V3.08148C3.17584 2.25305 3.84741 1.58148 4.67584 1.58148H8.92584C9.75429 1.58148 10.4258 2.25306 10.4258 3.08148V7.33636Z";

/** 12x12 viewBox, stroked at width 1.5 with round caps and joins. */
export const CHECK_ICON_PATH = "M10 3L4.5 8.5L2 6";

/** The copy glyph as an HTML string, for renderers that emit markup directly. */
export const COPY_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="${COPY_ICON_PATH}" fill="currentColor"/></svg>`;

/** The check glyph as an HTML string, swapped in after a successful copy. */
export const CHECK_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="${CHECK_ICON_PATH}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
