import {Link} from "@tanstack/react-router";
import {ChartLine, FileText, Palette, Presentation, type LucideIcon} from "lucide-react";
import {useId} from "react";
import {ARTIFACT_TEMPLATES, type ArtifactTemplate, type ArtifactTemplateSlug} from "../lib/artifact-templates";

const TEMPLATE_ICONS: Record<ArtifactTemplateSlug, LucideIcon> = {
	pages: FileText,
	slides: Presentation,
	design: Palette,
	dashboard: ChartLine,
};

/** Upstream's cds Badge: New is accent on tint-blue, Beta is secondary on neutral. */
const BADGE_CLASS: Record<ArtifactTemplate["badge"], string> = {
	New: "bg-upstream-tint-blue text-upstream-accent",
	Beta: "bg-alpha-1 text-secondary",
};

/**
 * Upstream's Artifacts "Make something new" strip. Each tile opens home with `?create=<slug>`, which
 * prefills the composer with a starter prompt; sending it starts a herdr session that makes the
 * artifact. Upstream's hover mini-animations are replaced by a static hue gradient.
 */
export function MakeSomethingNew() {
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

function TemplateTile({template}: Readonly<{template: ArtifactTemplate}>) {
	const descriptionId = useId();
	const Icon = TEMPLATE_ICONS[template.slug];
	return (
		<Link
			to="/"
			search={{create: template.slug}}
			aria-label={`${template.label}, ${template.badge}`}
			{...(template.description === undefined ? {} : {"aria-describedby": descriptionId})}
			className="group flex w-34 flex-col gap-1.5 rounded-composer outline-none transition-transform duration-150 hide-focus-ring focus-visible:shadow-focus motion-safe:active:scale-[0.98]"
		>
			<span
				aria-hidden="true"
				data-template-tile
				className="relative block w-34 h-24 rounded-composer bg-surface-2 shadow-sm transition-shadow duration-200 ease-out group-hover:shadow-md after:pointer-events-none after:absolute after:inset-0 after:rounded-composer after:ring-1 after:ring-inset after:ring-alpha-2 after:transition-shadow after:duration-200 after:ease-out group-hover:after:ring-[var(--tile-ring)]"
				style={{"--tile-ring": `color-mix(in srgb, ${template.hue} 50%, transparent)`}}
			>
				<span
					className="absolute inset-1.5 flex items-center justify-center overflow-hidden rounded"
					style={{
						background: `linear-gradient(135deg, color-mix(in srgb, ${template.hue} 24%, transparent), color-mix(in srgb, ${template.hue} 6%, transparent))`,
						color: template.hue,
					}}
				>
					<Icon className="size-6" />
				</span>
			</span>
			<span className="flex min-h-4 min-w-0 items-center gap-1.5 px-0.5 text-footnote font-medium text-primary">
				<span className="truncate">{template.label}</span>
				<span
					className={`inline-flex h-[18px] shrink-0 items-center whitespace-nowrap rounded-r4 px-1.5 text-caption font-medium ${BADGE_CLASS[template.badge]}`}
				>
					{template.badge}
				</span>
			</span>
			{template.description === undefined ? null : (
				<span id={descriptionId} className="sr-only select-none">
					{template.description}
				</span>
			)}
		</Link>
	);
}
