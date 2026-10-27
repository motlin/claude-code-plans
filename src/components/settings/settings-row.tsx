import {type ReactNode, useContext, useEffect, useId, useMemo, useRef} from "react";
import {SettingsFlashContext, SettingsRowContext, SettingsTabContext} from "./settings-row-context";

/*
 * Settings section and row anatomy copied from claude.ai/code: an h3 at
 * 15/20 weight 580 over `settings-group-dividers` rows. Each row is a
 * role=group labelled by its title and described by its description, with the
 * control column (data-settings-control) on the right, gap-lg (28px) apart and
 * py-md (12px) with hairline dividers between rows.
 */

/** Upstream's section ids are the title in kebab case (`#code-appearance`). */
function sectionId(title: string): string {
	return title
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, "-")
		.replaceAll(/^-|-$/g, "");
}

export function SettingsSection({
	id,
	title,
	subtitle,
	children,
}: {
	/** Defaults to the kebab-cased title. */
	id?: string;
	/** Omit for an untitled trailing section (no header, no id). */
	title?: string;
	subtitle?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section
			id={id ?? (title === undefined ? undefined : sectionId(title))}
			data-settings-section-titled={title === undefined ? undefined : ""}
			className="mb-10 last:mb-0"
		>
			{title === undefined ? null : (
				<div data-settings-group-header="" className="mb-4 flex items-start justify-between gap-7">
					<div className="flex min-w-0 flex-col gap-1">
						<h3
							data-settings-group-title=""
							className="settings-row-title self-start text-[15px] leading-[20px] font-[580] text-primary outline-none"
						>
							{title}
						</h3>
						{subtitle === undefined ? null : <div className="text-footnote text-secondary">{subtitle}</div>}
					</div>
				</div>
			)}
			<div className="[&>:not([hidden])~:not([hidden])]:border-t [&>:not([hidden])~:not([hidden])]:border-subtle dark:[&>:not([hidden])~:not([hidden])]:border-white/5 not-dark:[&>:not([hidden])~:not([hidden])]:border-primary/5">
				{children}
			</div>
		</section>
	);
}

interface SettingsRowProps {
	slug: string;
	title: string;
	description?: ReactNode;
	children?: ReactNode;
	/** Extra content under the description (warnings, notes). */
	footnote?: ReactNode;
	/**
	 * Content under the whole row (a write-failure alert). Like upstream, the row then becomes a
	 * column (`flex-col gap-sm py-md`) around its inner title/control row.
	 */
	below?: ReactNode;
	className?: string;
}

export function SettingsRow({slug, title, description, children, footnote, below, className}: SettingsRowProps) {
	const baseId = useId();
	const titleId = `${baseId}-title`;
	const descriptionId = description === undefined ? undefined : `${baseId}-description`;
	const tab = useContext(SettingsTabContext);
	const flash = useContext(SettingsFlashContext);
	const flashing = flash?.row === slug;
	const lit = flashing && flash.lit;
	const rowRef = useRef<HTMLDivElement>(null);
	const rowIds = useMemo(() => ({titleId, descriptionId}), [titleId, descriptionId]);

	useEffect(() => {
		if (flashing && !flash.lit) rowRef.current?.scrollIntoView({block: "center", behavior: "smooth"});
	}, [flash, flashing]);

	const inner = (
		<>
			<div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
				<div id={titleId} className="text-body text-primary">
					<span
						className={`settings-row-title inline-block align-top ${lit ? "feature-anchor-highlight" : ""}`}
					>
						{title}
					</span>
				</div>
				{description === undefined ? null : (
					<div id={descriptionId} data-settings-desc="" className="text-body text-[var(--settings-muted)]">
						{description}
					</div>
				)}
				{footnote}
			</div>
			{children === undefined ? null : (
				<div data-settings-control="" className="flex shrink-0 items-center">
					{children}
				</div>
			)}
		</>
	);

	return (
		<SettingsRowContext.Provider value={rowIds}>
			<div
				role="group"
				aria-labelledby={titleId}
				aria-describedby={descriptionId}
				ref={rowRef}
				id={tab === null ? undefined : `setting-${tab}-${slug}`}
				// Upstream's data-settings-row is empty; here it holds the slug, which search and the deep-link flash key off.
				data-settings-row={slug}
				data-settings-item=""
				className={`group/setting ${below === undefined ? "flex items-center justify-between gap-7" : "flex flex-col gap-2"} py-3 ${lit ? "feature-anchor-row-fill" : ""} ${className ?? ""}`}
			>
				{below === undefined ? (
					inner
				) : (
					<>
						<div className="flex items-center justify-between gap-7">{inner}</div>
						{below}
					</>
				)}
			</div>
		</SettingsRowContext.Provider>
	);
}
