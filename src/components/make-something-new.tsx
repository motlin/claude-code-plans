import {Link} from "@tanstack/react-router";
import {useId} from "react";
import {TEMPLATE_ICONS} from "./artifact-template-icons";
import {ARTIFACT_TEMPLATES, type ArtifactTemplate} from "../lib/artifact-templates";

/** Upstream's cds Badge: New is accent on tint-blue, Beta is secondary on neutral. */
const BADGE_CLASS: Record<ArtifactTemplate["badge"], string> =
{
	New: "bg-upstream-tint-blue text-upstream-accent",
	Beta: "bg-alpha-1 text-secondary",
};

/**
 * Upstream's Artifacts "Make something new" strip. Each tile opens home with `?create=<slug>`, which
 * prefills the composer with a starter prompt; sending it starts a herdr session that makes the
 * artifact. Each tile is a solid hue with a grain texture and grows to 103% on hover.
 */
export function MakeSomethingNew()
{
	const headingId = useId();
	return (
		<section aria-labelledby={headingId} data-make-something-new className="mb-10 flex flex-col gap-3">
			<h2 id={headingId} className="text-caption font-medium text-ink-muted">
				Make something new
			</h2>
			<div className="relative">
				<ul className="relative -m-2 flex items-start gap-3 overflow-x-auto overflow-y-hidden p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
					{ARTIFACT_TEMPLATES.map((template) => (
						<li key={template.slug} className="shrink-0">
							<TemplateTile template={template} />
						</li>
					))}
					<li aria-hidden="true" className="w-10 shrink-0 self-stretch" />
				</ul>
			</div>
		</section>
	);
}

function TemplateTile({
	template,
}: Readonly<
{
	template: ArtifactTemplate;
}>)
{
	const descriptionId = useId();
	const Icon = TEMPLATE_ICONS[template.slug];
	return (
		<Link
			to="/"
			search={
			{
				create: template.slug,
			}}
			aria-label={`${template.label}, ${template.badge}`}
			{...(template.description === undefined
				? {}
				:
					{
						"aria-describedby": descriptionId,
					})}
			className="group flex w-34 flex-col gap-1.5 rounded-composer outline-none transition-transform duration-150 hide-focus-ring focus-visible:shadow-focus motion-safe:active:scale-[0.98]"
		>
			<span
				aria-hidden="true"
				data-template-tile
				className={`relative flex h-24 w-34 items-center justify-center overflow-hidden rounded-composer transition-transform duration-200 ease-out motion-safe:group-hover:scale-[1.03] ${template.tileClass}`}
			>
				<TileGrain />
				<span className="relative flex">
					<Icon className="size-14" />
				</span>
			</span>
			<span className="flex min-h-4 min-w-0 items-center gap-1.5 px-0.5 text-footnote font-medium text-primary">
				<span className="truncate">{template.label}</span>
				<TemplateBadge badge={template.badge} />
			</span>
			{template.description === undefined ? null : (
				<span id={descriptionId} className="sr-only select-none">
					{template.description}
				</span>
			)}
		</Link>
	);
}

/** Upstream's 12% grain over the tile hue: fractal noise displaced by 1.6. */
function TileGrain()
{
	const filterId = useId();
	return (
		<span className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] opacity-[0.12]">
			<svg aria-hidden="true" viewBox="0 0 115 80" preserveAspectRatio="xMidYMid slice" className="size-full">
				<filter id={filterId}>
					<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="noise" />
					<feDisplacementMap in="noise" in2="noise" scale="1.6" />
				</filter>
				<rect width="115" height="80" filter={`url(#${filterId})`} />
			</svg>
		</span>
	);
}

/** A template's xs cds Badge ("New" or "Beta"), shared by the strip tiles and the sidebar template menu. */
export function TemplateBadge({
	badge,
	className,
}: Readonly<
{
	badge: ArtifactTemplate["badge"];
	className?: string;
}>)
{
	return (
		<span
			className={`inline-flex h-[18px] shrink-0 items-center whitespace-nowrap rounded-r4 px-1.5 text-caption font-medium ${BADGE_CLASS[badge]}${className === undefined ? "" : ` ${className}`}`}
		>
			{badge}
		</span>
	);
}
