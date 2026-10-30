/** Upstream's `?create=` slugs for the Artifacts "Make something new" templates (Docs is `pages`). */
export type ArtifactTemplateSlug = "pages" | "slides" | "design" | "dashboard";

export interface ArtifactTemplate {
	slug: ArtifactTemplateSlug;
	label: string;
	/** Upstream's type hue: the tile's gradient and its 50% hover ring. */
	hue: string;
	badge: "New" | "Beta";
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
		description:
			"By Anthropic. A document your team reads, comments on and edits in place while Claude keeps it current.",
	},
	{slug: "slides", label: "Slides", hue: "#b7791f", badge: "New"},
	{slug: "design", label: "Design", hue: "#7663b8", badge: "New"},
	{slug: "dashboard", label: "Dashboard", hue: "var(--color-violet-500)", badge: "Beta"},
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
