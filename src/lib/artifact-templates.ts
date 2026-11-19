import type {ArtifactMarkKind} from "./artifact-mark";

/** Upstream's `?create=` slugs for the Artifacts "Make something new" templates (Docs is `pages`). */
export type ArtifactTemplateSlug = "pages" | "slides" | "design" | "dashboard";

export interface ArtifactTemplate
{
	slug: ArtifactTemplateSlug;
	label: string;
	/** Upstream's strip tile hue pair: `bg-<hue>-100 text-<hue>-600`, dark `-700` / `-200`, from the cds palette. */
	tileClass: string;
	/** Upstream dropped the "New" badges (2026-11-10); only Data keeps "Beta". */
	badge?: "Beta";
	/** Upstream's `ArtifactMark` kind for the template menu row. */
	markKind: ArtifactMarkKind;
	/** Upstream's sr-only catalog description (served by the catalog, not the bundle). */
	description: string;
}

/** Upstream's four tiles, in order (artifacts-gallery-delta dump). */
export const ARTIFACT_TEMPLATES: readonly ArtifactTemplate[] = [
	{
		slug: "pages",
		label: "Docs",
		tileClass: "bg-cds-blue-100 text-cds-blue-600 dark:bg-cds-blue-700 dark:text-cds-blue-200",
		markKind: "document",
		description:
			"By Anthropic. A document your team reads, comments on and edits in place while Claude keeps it current.",
	},
	{
		slug: "slides",
		label: "Slides",
		tileClass: "bg-cds-orange-100 text-cds-orange-600 dark:bg-cds-orange-700 dark:text-cds-orange-200",
		markKind: "slides",
		description: "By Anthropic. A deck you can present, restyle with a design system and export to PowerPoint.",
	},
	{
		slug: "design",
		label: "Design",
		tileClass: "bg-cds-violet-100 text-cds-violet-600 dark:bg-cds-violet-700 dark:text-cds-violet-200",
		markKind: "design",
		description:
			"By Anthropic. Screens, flows and graphics laid out as artboards on one canvas you can edit by hand.",
	},
	{
		slug: "dashboard",
		label: "Data",
		tileClass: "bg-cds-red-100 text-cds-red-600 dark:bg-cds-red-700 dark:text-cds-red-200",
		badge: "Beta",
		markKind: "chart",
		description: "By Anthropic. Charts, numbers and tables from your data, each marked with its source.",
	},
];

export function isArtifactTemplateSlug(value: unknown): value is ArtifactTemplateSlug
{
	return ARTIFACT_TEMPLATES.some((template) => template.slug === value);
}

/**
 * The home composer's starter prompt for a template. Upstream binds a cloud session to the artifact
 * type; locally the prompt asks the new herdr session's Claude to make (and publish) one.
 */
export function artifactTemplatePrompt(slug: ArtifactTemplateSlug): string
{
	const template = ARTIFACT_TEMPLATES.find((candidate) => candidate.slug === slug);
	return `Make a ${template?.label ?? slug} artifact: `;
}
