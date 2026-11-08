/*
 * Upstream's shared ArtifactMark (shared-9 `HB`/`vL`/`NH`/`Go`/`$A`/`y8`/`PO`): a kind → hue + glyph table, the
 * tile and bare-glyph classes per size, and the resolver that picks a kind from an artifact's type and glyph.
 * Local inputs stand in for upstream's: the known type URL's kind for `typeSlug`, the type's name for
 * `typeName`, the publish's icon word for `declaredGlyph`. The `inline`/`chip` sizes are not shipped
 * (artifact-inline-chip-mark: no local consumer).
 */
import type {ArtifactSummary} from "./api/artifacts";
import type {IconName} from "../components/ui/icon";

export type ArtifactMarkHue = "blue" | "orange" | "violet" | "red" | "aqua" | "yellow" | "magenta" | "green" | "gray";

/** Upstream `HB`: every kind's outline Anthropicons glyph and hue (`file` is the fallback). */
export const ARTIFACT_MARK_KINDS = {
	document: {icon: "File", hue: "blue"},
	slides: {icon: "Slides", hue: "orange"},
	design: {icon: "Palette", hue: "violet"},
	chart: {icon: "Chart", hue: "red"},
	animation: {icon: "Animation", hue: "aqua"},
	web: {icon: "Globe", hue: "yellow"},
	video: {icon: "Play", hue: "magenta"},
	code: {icon: "Code", hue: "gray"},
	image: {icon: "Image", hue: "red"},
	diagram: {icon: "Diagram", hue: "green"},
	file: {icon: "Artifacts", hue: "gray"},
} as const satisfies Record<string, {icon: IconName; hue: ArtifactMarkHue}>;

export type ArtifactMarkKind = keyof typeof ARTIFACT_MARK_KINDS;

/** Upstream `vL`: a tile's tint background and ink. */
const MARK_TILE_TONE: Record<ArtifactMarkHue, string> = {
	blue: "bg-tint-blue text-tint-blue",
	orange: "bg-tint-orange text-tint-orange",
	violet: "bg-tint-violet text-tint-violet",
	red: "bg-tint-red text-tint-red",
	aqua: "bg-tint-aqua text-tint-aqua",
	yellow: "bg-tint-yellow text-tint-yellow",
	magenta: "bg-tint-magenta text-tint-magenta",
	green: "bg-tint-green text-tint-green",
	gray: "bg-fill-secondary text-secondary",
};

/** Upstream `NH`: a bare glyph's ink. */
export const MARK_INK: Record<ArtifactMarkHue, string> = {
	blue: "text-tint-blue",
	orange: "text-tint-orange",
	violet: "text-tint-violet",
	red: "text-tint-red",
	aqua: "text-tint-aqua",
	yellow: "text-tint-yellow",
	magenta: "text-tint-magenta",
	green: "text-tint-green",
	gray: "text-secondary",
};

/** Upstream `Go`: tile sizes carry a box; menu sizes are bare glyphs (md 20px / sm 16px whatever the density). */
export const ARTIFACT_MARK_SIZES = {
	card: {box: "size-10 shrink-0 overflow-hidden rounded-lg", glyph: "md"},
	row: {box: "size-7 shrink-0 overflow-hidden rounded-[25%]", glyph: "sm"},
	menu: {box: undefined, glyph: "md"},
	"menu-small": {box: undefined, glyph: "sm"},
} as const satisfies Record<string, {box: string | undefined; glyph: "sm" | "md"}>;

export type ArtifactMarkSize = keyof typeof ARTIFACT_MARK_SIZES;

/** The publish's icon word → its declared glyph: a file-kind mark's local stand-in for upstream's `declaredGlyph`. */
export const TYPE_MEDIA_ICONS = {
	chart: "Chart",
	doc: "File",
	code: "Code",
	map: "MapPin",
	calendar: "Calendar",
} as const satisfies Record<string, IconName>;

export type TypeMediaIconWord = keyof typeof TYPE_MEDIA_ICONS;

export function isTypeMediaIconWord(word: string): word is TypeMediaIconWord {
	return Object.hasOwn(TYPE_MEDIA_ICONS, word);
}

/** The span's classes: upstream `n8`'s tile (`{box} {vL}`) or bare (`{NH}`) branch. */
export function artifactMarkClassName(kind: ArtifactMarkKind, size: ArtifactMarkSize): string {
	const {hue} = ARTIFACT_MARK_KINDS[kind];
	const {box} = ARTIFACT_MARK_SIZES[size];
	return box === undefined
		? `flex shrink-0 items-center justify-center ${MARK_INK[hue]}`
		: `flex items-center justify-center ${box} ${MARK_TILE_TONE[hue]}`;
}

/** The gallery kind of each known Artifact type, keyed by the type's URL (upstream's typeSlug → `F0`). */
export const ARTIFACT_TYPE_KINDS: Readonly<Record<string, ArtifactSummary["kind"]>> = {
	"https://claude.ai/artifact/Rp9naXUCj2xozpUkyQy19W": "docs",
};

/** A known type's mark kind (upstream `CV`): only Docs is a type locally; `html` means untyped. */
const TYPE_KIND_MARKS: Partial<Record<ArtifactSummary["kind"], ArtifactMarkKind>> = {docs: "document"};

/** Upstream `vj`: a type's trimmed, lower-cased name → kind. */
const TYPE_NAME_MARKS: Readonly<Record<string, ArtifactMarkKind>> = {
	docs: "document",
	doc: "document",
	document: "document",
	slides: "slides",
	design: "design",
	"design system": "design",
	"html page": "web",
	"web app": "web",
	video: "video",
	motion: "animation",
	animation: "animation",
	dashboard: "chart",
};

/** Upstream `w2` (lower-cased) plus the local publish icon words: a declared glyph → kind. */
const GLYPH_WORD_MARKS: Readonly<Record<string, ArtifactMarkKind>> = {
	doc: "document",
	file: "document",
	note: "document",
	slides: "slides",
	palette: "design",
	code: "code",
	codebrackets: "code",
	codeblock: "code",
	globe: "web",
	atom: "web",
	image: "image",
	diagram: "diagram",
	chart: "chart",
	chartline: "chart",
	playcircle: "animation",
	play: "video",
};

function lookup(
	table: Readonly<Record<string, ArtifactMarkKind>>,
	key: string | undefined,
): ArtifactMarkKind | undefined {
	return key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;
}

export interface ArtifactMarkInput {
	typeKind?: ArtifactSummary["kind"] | undefined;
	typeName?: string | undefined;
	iconWord?: string | null | undefined;
}

/**
 * Upstream `$A` + `y8` + `PO`: the first hit of type kind → type name → declared glyph → `file`. The glyph only
 * counts for a typed artifact (upstream c33ae67d6 `z()`/`rL` drop an untyped publish's icon), and an untyped
 * `file` gets no mark at all, so callers draw their own fallback.
 */
export function resolveArtifactMark(
	input: ArtifactMarkInput,
): {kind: ArtifactMarkKind; hue: ArtifactMarkHue} | undefined {
	const typeKind = input.typeKind === undefined ? undefined : TYPE_KIND_MARKS[input.typeKind];
	const typed = typeKind !== undefined || input.typeName !== undefined;
	if (!typed) return undefined;
	const kind =
		typeKind ??
		lookup(TYPE_NAME_MARKS, input.typeName?.trim().toLowerCase()) ??
		lookup(GLYPH_WORD_MARKS, input.iconWord?.toLowerCase()) ??
		"file";
	return {kind, hue: ARTIFACT_MARK_KINDS[kind].hue};
}

/**
 * Upstream's cover blank pick (`Ee`): the resolved mark kind's drawing, else `other`. Locally only Docs is
 * typed, and an untyped publish's icon never reaches the resolver (c33ae67d6 `z()` keeps `icon` only for typed
 * or tinted artifacts), so the icon word is never read here.
 */
export function coverBlankKind(artifact: Pick<ArtifactSummary, "kind" | "icon">): "document" | "other" {
	return artifact.kind === "docs" ? "document" : "other";
}
