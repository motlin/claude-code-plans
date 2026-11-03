/** Upstream's `?create=` slugs for the Artifacts "Make something new" templates (Docs is `pages`). */
export type ArtifactTemplateSlug = "pages" | "slides" | "design" | "dashboard";

/** Upstream's `ArtifactMark` kinds (`HB`) for the four templates. */
export type ArtifactMarkKind = "document" | "slides" | "design" | "chart";

export interface ArtifactTemplate {
	slug: ArtifactTemplateSlug;
	label: string;
	/** Upstream's strip tile hue pair: `bg-<hue>-100 text-<hue>-600`, dark `-700` / `-200`, from the cds palette. */
	tileClass: string;
	badge: "New" | "Beta";
	/** Upstream's `ArtifactMark` kind for the template menu row. */
	markKind: ArtifactMarkKind;
	/**
	 * Upstream's default (no color flag) `pK` mark tile fill: blue-400/orange-350/violet-450/red-450, dark
	 * blue-450/orange-400/violet-500/red-500, from the live palette scale (dumps/template-menu-marks-2026-11-03.txt).
	 */
	markClass: string;
	/** Upstream's fizzy-lake color `NH` bare glyph ink: `--cds-text-tint-<hue>` light and dark. */
	glyphClass: string;
	/** Upstream's sr-only catalog description; only Docs' was captured from the live page. */
	description?: string;
}

/** Upstream's four tiles, in order (artifacts-gallery-delta dump). */
export const ARTIFACT_TEMPLATES: readonly ArtifactTemplate[] = [
	{
		slug: "pages",
		label: "Docs",
		tileClass: "bg-cds-blue-100 text-cds-blue-600 dark:bg-cds-blue-700 dark:text-cds-blue-200",
		badge: "New",
		markKind: "document",
		markClass: "bg-[#338ced] dark:bg-[#257de0]",
		glyphClass: "text-[#1757ac] dark:text-[#6aabf1]",
		description:
			"By Anthropic. A document your team reads, comments on and edits in place while Claude keeps it current.",
	},
	{
		slug: "slides",
		label: "Slides",
		tileClass: "bg-cds-orange-100 text-cds-orange-600 dark:bg-cds-orange-700 dark:text-cds-orange-200",
		badge: "New",
		markKind: "slides",
		markClass: "bg-[#f47230] dark:bg-[#e76624]",
		glyphClass: "text-[#90370f] dark:text-[#f18a59]",
	},
	{
		slug: "design",
		label: "Design",
		tileClass: "bg-cds-violet-100 text-cds-violet-600 dark:bg-cds-violet-700 dark:text-cds-violet-200",
		badge: "New",
		markKind: "design",
		markClass: "bg-[#785ee8] dark:bg-[#6a4ce2]",
		glyphClass: "text-[#5437b8] dark:text-[#a89af0]",
	},
	{
		slug: "dashboard",
		label: "Dashboard",
		tileClass: "bg-cds-red-100 text-cds-red-600 dark:bg-cds-red-700 dark:text-cds-red-200",
		badge: "Beta",
		markKind: "chart",
		markClass: "bg-[#dc3c3d] dark:bg-[#c83839]",
		glyphClass: "text-[#a42528] dark:text-[#f17778]",
	},
];

export function isArtifactTemplateSlug(value: unknown): value is ArtifactTemplateSlug {
	return ARTIFACT_TEMPLATES.some((template) => template.slug === value);
}

/**
 * The home composer's starter prompt for a template. Upstream binds a cloud session to the artifact
 * type; locally the prompt asks the new herdr session's Claude to make (and publish) one.
 */
export function artifactTemplatePrompt(slug: ArtifactTemplateSlug): string {
	const template = ARTIFACT_TEMPLATES.find((candidate) => candidate.slug === slug);
	return `Make a ${template?.label ?? slug} artifact: `;
}
