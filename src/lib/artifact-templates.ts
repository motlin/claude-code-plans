/** Upstream's `?create=` slugs for the Artifacts "Make something new" templates (Docs is `pages`). */
export type ArtifactTemplateSlug = "pages" | "slides" | "design" | "dashboard";

/** Upstream's `ArtifactMark` kinds (`HB`) for the four templates. */
export type ArtifactMarkKind = "document" | "slides" | "design" | "chart";

export interface ArtifactTemplate {
	slug: ArtifactTemplateSlug;
	label: string;
	/** Upstream's type hue: the tile's gradient and its 50% hover ring. */
	hue: string;
	badge: "New" | "Beta";
	/** Upstream's `ArtifactMark` kind for the template menu row. */
	markKind: ArtifactMarkKind;
	/**
	 * Upstream's default (no color flag) `pK` mark tile fill: blue-400/orange-350/violet-450/red-450, dark
	 * blue-450/orange-400/violet-500/red-500. Light values are 2026-11-01 computed colours; the dark orange,
	 * violet and red come from the root-vars survey palette.
	 */
	markClass: string;
	/** Upstream's sr-only catalog description; only Docs' was captured from the live page. */
	description?: string;
}

/** Upstream's four tiles, in order (artifacts-gallery-delta dump). */
export const ARTIFACT_TEMPLATES: readonly ArtifactTemplate[] = [
	{
		slug: "pages",
		label: "Docs",
		hue: "var(--color-blue-500)",
		badge: "New",
		markKind: "document",
		markClass: "bg-[rgb(51,140,237)] dark:bg-[rgb(37,125,224)]",
		description:
			"By Anthropic. A document your team reads, comments on and edits in place while Claude keeps it current.",
	},
	{
		slug: "slides",
		label: "Slides",
		hue: "#b7791f",
		badge: "New",
		markKind: "slides",
		markClass: "bg-[rgb(244,114,48)] dark:bg-[#d95926]",
	},
	{
		slug: "design",
		label: "Design",
		hue: "#7663b8",
		badge: "New",
		markKind: "design",
		markClass: "bg-[rgb(120,94,232)] dark:bg-[#6250d6]",
	},
	{
		slug: "dashboard",
		label: "Dashboard",
		hue: "var(--color-violet-500)",
		badge: "Beta",
		markKind: "chart",
		markClass: "bg-[rgb(220,60,61)] dark:bg-[#b93535]",
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
