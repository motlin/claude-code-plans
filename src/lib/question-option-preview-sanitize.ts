import DOMPurify, {type UponSanitizeAttributeHookEvent} from "dompurify";

import {replaceHiddenChars} from "./hidden-chars";

// Loaded on demand by question-option-preview, so DOMPurify stays out of the session chunks.

/** Upstream's `yj`. */
const ALLOWED_TAGS =
	"div span p h1 h2 h3 h4 h5 h6 strong em b i u code pre br hr ul ol li table thead tbody tr th td button blockquote section header footer nav main article aside figure figcaption".split(
		" ",
	);
const FORBID_ATTR = [
	"class",
	"id",
	"role",
	"tabindex",
	"contenteditable",
	"background",
	"popover",
	"popovertarget",
	"popovertargetaction",
	"command",
	"commandfor",
];
/** Upstream's `AP`. */
const UNSAFE_STYLE_RE = /\\|\/\*|user-modify/i;
/** Upstream's `V3`: the CSS functions a preview's style may call. */
const STYLE_FUNCTIONS: ReadonlySet<string> = new Set(
	"rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix light-dark calc min max clamp round mod rem abs sign pow sqrt hypot sin cos tan linear-gradient radial-gradient conic-gradient repeating-linear-gradient repeating-radial-gradient repeating-conic-gradient repeat minmax fit-content translate translatex translatey translatez translate3d scale scalex scaley scalez scale3d rotate rotatex rotatey rotatez rotate3d skew skewx skewy matrix matrix3d perspective blur brightness contrast drop-shadow grayscale hue-rotate invert opacity saturate sepia cubic-bezier steps linear".split(
		" ",
	),
);
/** Upstream's `sw`. */
const STYLE_WORD_RE = /(-?[a-z][a-z0-9-]*)(\s*\()?/gi;
/** Upstream's `b6`. */
const MAX_STYLE_LENGTH = 4096;
/** Upstream's `ux`. */
const STYLE_PASSES = 3;

/** Upstream's `ti`: every function the style calls is allowed. */
function callsOnlyAllowedFunctions(style: string): boolean {
	for (const match of style.matchAll(STYLE_WORD_RE))
		if (match[2] !== undefined && !STYLE_FUNCTIONS.has((match[1] ?? "").toLowerCase())) return false;
	return true;
}

/** One pass of upstream's style declaration removals. */
function stripStylePass(style: string): string {
	return style
		.replace(/position\s*:\s*(fixed|absolute)[^;]*;?/gi, "")
		.replace(/z-index\s*:[^;]*;?/gi, "")
		.replace(/font-family\s*:[^;]*;?/gi, "")
		.replace(/(^|;)\s*font\s*:[^;]*;?/gi, "$1")
		.replace(/unicode-bidi\s*:[^;]*override[^;]*;?/gi, "")
		.replace(/(^|;)\s*content\s*:[^;]*;?/gi, "$1")
		.replace(/list-style(?:-type)?\s*:[^;]*["'][^;]*;?/gi, "");
}

function sanitizeAttribute(_node: Element, data: UponSanitizeAttributeHookEvent) {
	data.attrValue = replaceHiddenChars(data.attrValue);
	if (data.attrName !== "style") return;
	if (data.attrValue.length > MAX_STYLE_LENGTH) {
		data.keepAttr = false;
		return;
	}
	let style = data.attrValue;
	let stable = false;
	for (let pass = 0; pass < STYLE_PASSES && !stable; pass += 1) {
		const next = stripStylePass(style);
		stable = next === style;
		style = next;
	}
	if (
		!stable ||
		UNSAFE_STYLE_RE.test(data.attrValue) ||
		UNSAFE_STYLE_RE.test(style) ||
		!callsOnlyAllowedFunctions(data.attrValue) ||
		!callsOnlyAllowedFunctions(style)
	) {
		data.keepAttr = false;
		return;
	}
	data.attrValue = style;
}

/** Upstream's `Oc`: DOMPurify with the preview allowlist, inert buttons and a filtered `style`. */
export function sanitizePreviewHtml(html: string): string {
	if (typeof window === "undefined") return "";
	const purify = DOMPurify(window);
	if (!purify.isSupported) return "";
	purify.addHook("afterSanitizeAttributes", (node) => {
		if (node.tagName === "BUTTON") {
			node.setAttribute("type", "button");
			node.setAttribute("tabindex", "-1");
		}
	});
	purify.addHook("uponSanitizeElement", (node) => {
		if (node.nodeType === Node.TEXT_NODE && node.textContent)
			node.textContent = replaceHiddenChars(node.textContent);
	});
	purify.addHook("uponSanitizeAttribute", sanitizeAttribute);
	try {
		return purify.sanitize(html, {
			ALLOWED_TAGS,
			ADD_ATTR: ["style"],
			ALLOW_DATA_ATTR: false,
			ALLOW_ARIA_ATTR: false,
			FORBID_ATTR,
		});
	} finally {
		purify.removeAllHooks();
	}
}
