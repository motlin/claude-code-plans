import {BadgeCheck, type LucideIcon} from "lucide-react";
import {Fragment, type ReactNode} from "react";
import {Tooltip} from "../ui/tooltip";
import {IconTile} from "./icon-tile";

interface ListRowProps {
	icon: LucideIcon;
	title: string;
	/** Leading source text, rendered as "<source> · <subtitle>". */
	source?: string;
	subtitle?: string;
	/** Trailing muted text, e.g. a `<time>`. */
	meta?: ReactNode;
	/** Trailing controls; they stay clickable above the overlay button. */
	actions?: ReactNode;
	/** When set, the whole row is an overlay button labelled "View <title>". */
	onView?: () => void;
	/** Unified search hit: the kind word ("Skill", "Plugin", …) that leads the second line. */
	kind?: string;
	/** Unified search hit: the range of the query in `title`, rendered semibold. */
	match?: readonly [number, number] | null;
	/** Unified search hit: a Verified badge after the name. */
	verified?: boolean;
	testId?: string;
}

const MUTED_FOOTNOTE = "text-footnote leading-4 text-muted-as-secondary";

function HighlightedName({title, match}: {title: string; match: readonly [number, number] | null}) {
	if (match === null) return <span>{title}</span>;
	const [start, end] = match;
	return (
		<>
			{start > 0 && <span>{title.slice(0, start)}</span>}
			<span className="font-[580] text-primary">{title.slice(start, end)}</span>
			{end < title.length && <span>{title.slice(end)}</span>}
		</>
	);
}

/** Upstream unified search hit text: highlighted name + Verified over "kind · byline · description". */
function HitText({
	title,
	kind,
	match,
	verified,
	parts,
}: {
	title: string;
	kind: string;
	match: readonly [number, number] | null;
	verified: boolean;
	parts: readonly (string | undefined)[];
}) {
	const present = parts.filter((part): part is string => part !== undefined && part !== "");
	const lead = [kind, ...present.slice(0, -1)];
	const last = present.at(-1);
	return (
		<div className="flex min-w-0 flex-1 flex-col gap-0.5">
			<div
				data-testid="tabbed-list-item-row-name-line"
				className="flex min-w-0 items-center gap-2 text-body font-medium text-primary"
			>
				<span className="inline-flex min-h-[1lh] min-w-0 max-w-full items-center gap-1.5">
					<span className="truncate">
						<HighlightedName title={title} match={match} />
					</span>
					{verified && (
						<Tooltip content="Verified">
							<span
								// oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focusable so keyboard users can open the Verified tooltip
								tabIndex={0}
								className="pointer-events-auto relative inline-flex shrink-0 outline-none"
							>
								<span
									role="img"
									aria-label="Verified"
									className="relative inline-flex text-muted-as-secondary"
								>
									<BadgeCheck aria-hidden="true" className="size-4" />
								</span>
							</span>
						</Tooltip>
					)}
				</span>
			</div>
			<div
				data-testid="tabbed-list-item-row-second-line"
				className="flex min-w-0 items-center gap-1.5 overflow-hidden"
			>
				{lead.map((part, index) => (
					<Fragment key={index}>
						{index > 0 && (
							<span aria-hidden="true" className={`shrink-0 ${MUTED_FOOTNOTE}`}>
								·
							</span>
						)}
						<span className={`shrink-0 ${MUTED_FOOTNOTE}`}>{part}</span>
					</Fragment>
				))}
				{last !== undefined && (
					<>
						<span aria-hidden="true" className={`shrink-0 ${MUTED_FOOTNOTE}`}>
							·
						</span>
						<span className={`min-w-0 truncate ${MUTED_FOOTNOTE}`}>{last}</span>
					</>
				)}
			</div>
		</div>
	);
}

/**
 * Upstream tabbed list row: 36px icon tile, 14px medium title over a 13px
 * secondary subtitle, trailing meta and actions. A 1px `::after` divider sits
 * under every row except the last and disappears on hover.
 */
export function ListRow({
	icon,
	title,
	source,
	subtitle,
	meta,
	actions,
	onView,
	kind,
	match = null,
	verified = false,
	testId = "customize-list-row",
}: ListRowProps) {
	return (
		<div
			data-testid={testId}
			className="relative -mx-3 flex items-center gap-3 self-stretch rounded-card p-3 after:pointer-events-none after:absolute after:inset-x-3 after:bottom-0 after:h-px after:bg-border last:after:hidden hover:bg-fill-ghost-hover hover:after:hidden"
		>
			{onView && (
				<button
					type="button"
					aria-label={`View ${title}`}
					onClick={onView}
					className="absolute inset-0 rounded-card hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
				/>
			)}
			<div className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-3 [&_button]:pointer-events-auto">
				<IconTile icon={icon} />
				{kind === undefined ? (
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="truncate text-body font-medium text-primary">{title}</span>
						{(source !== undefined || subtitle !== undefined) && (
							<span className="truncate text-footnote text-secondary">
								{source !== undefined && <span>{source}</span>}
								{source !== undefined && subtitle !== undefined && (
									<span aria-hidden="true" className="px-1.5">
										·
									</span>
								)}
								{subtitle}
							</span>
						)}
					</div>
				) : (
					<HitText title={title} kind={kind} match={match} verified={verified} parts={[source, subtitle]} />
				)}
			</div>
			{(meta !== undefined || actions !== undefined) && (
				<div className="pointer-events-none relative flex shrink-0 items-center gap-4 [&_button]:pointer-events-auto">
					{meta !== undefined && <span className="truncate text-footnote text-t6">{meta}</span>}
					{actions}
				</div>
			)}
		</div>
	);
}
