// Mirror-div caret coordinates for a <textarea>: copy the textarea's
// text-layout styles onto a hidden div, fill it with the text before `index`,
// and measure a marker span holding the rest. Coordinates are relative to the
// textarea's border box, after its own scroll.

const MIRRORED_PROPERTIES = [
	"boxSizing",
	"width",
	"borderTopWidth",
	"borderRightWidth",
	"borderBottomWidth",
	"borderLeftWidth",
	"borderStyle",
	"paddingTop",
	"paddingRight",
	"paddingBottom",
	"paddingLeft",
	"fontStyle",
	"fontVariant",
	"fontWeight",
	"fontStretch",
	"fontSize",
	"fontSizeAdjust",
	"lineHeight",
	"fontFamily",
	"fontFeatureSettings",
	"fontVariationSettings",
	"textAlign",
	"textTransform",
	"textIndent",
	"textDecoration",
	"letterSpacing",
	"wordSpacing",
	"tabSize",
	"whiteSpace",
	"wordBreak",
	"overflowWrap",
	"direction",
] as const satisfies readonly (keyof CSSStyleDeclaration)[];

export interface TextareaCaretRect {
	left: number;
	top: number;
	height: number;
}

export function textareaCaretRect(textarea: HTMLTextAreaElement, index: number): TextareaCaretRect {
	const computed = window.getComputedStyle(textarea);
	const mirror = document.createElement("div");
	mirror.dataset["textareaCaretMirror"] = "";
	for (const property of MIRRORED_PROPERTIES) {
		mirror.style[property] = computed[property];
	}
	mirror.style.position = "absolute";
	mirror.style.top = "0";
	mirror.style.left = "-9999px";
	mirror.style.visibility = "hidden";
	mirror.style.overflow = "hidden";

	const value = textarea.value;
	mirror.append(document.createTextNode(value.slice(0, index)));
	const marker = document.createElement("span");
	marker.dataset["textareaCaretMarker"] = "";
	// An empty span has no line box; a placeholder keeps the caret's line.
	marker.textContent = value.slice(index) || ".";
	mirror.append(marker);

	document.body.append(mirror);
	try {
		const mirrorRect = mirror.getBoundingClientRect();
		const markerRect = marker.getBoundingClientRect();
		return {
			left: markerRect.left - mirrorRect.left - textarea.scrollLeft,
			top: markerRect.top - mirrorRect.top - textarea.scrollTop,
			height: markerRect.height,
		};
	} finally {
		mirror.remove();
	}
}
