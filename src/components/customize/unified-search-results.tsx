import {ChevronDown, ChevronUp, Plug, Puzzle, Scroll, SquareSlash, TriangleAlert, type LucideIcon} from "lucide-react";
import {useRef, useState} from "react";
import {CustomizeListRowsSkeleton} from "./customize-panel-skeleton";
import {ListRow} from "./list-row";
import {PluginRowActions, useCopyInstallCommand} from "./plugin-row-actions";
import {SkillRowActions} from "./skill-row-actions";
import {Tooltip} from "../ui/tooltip";
import {SectionHeader} from "./section-header";
import {
	searchTermReady,
	type UnifiedHit,
	type UnifiedHitActions,
	type UnifiedHitKind,
	type UnifiedSearch,
} from "./unified-search";

/** Upstream cds-reveal-in at --cds-dur-snap with --cds-ease-out. */
const REVEAL = "animate-[reveal-in_120ms_cubic-bezier(.165,.84,.44,1)] motion-reduce:animate-none";

/** Upstream `rf` / `af`: Yours collapses to 10 rows, More you can add to 12. */
const YOURS_LIMIT = 10;
const MORE_LIMIT = 12;

const KIND_ICON: Record<UnifiedHitKind, LucideIcon> = {
	Skill: Scroll,
	"Custom command": SquareSlash,
	Connector: Plug,
	Plugin: Puzzle,
};

const numberFormat = new Intl.NumberFormat("en-US");

/** Upstream cds ghost Button, size sm. */
const GHOST_SM_CLASS =
	"inline-flex h-7 shrink-0 items-center gap-1 rounded-r5 ps-2.5 pe-1.5 text-body text-primary transition-colors hover:bg-fill-ghost-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/** Upstream cds ghost Button, size base: the warning Banner's Retry. */
const GHOST_RETRY_CLASS =
	"inline-flex h-8 shrink-0 items-center rounded-r6 px-3 text-body font-medium transition-colors hover:bg-fill-ghost-hover disabled:opacity-50 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/** Upstream cds secondary Button, size base. */
const SECONDARY_CLASS =
	"inline-flex h-8 shrink-0 items-center px-3 rounded-r6 bg-fill-secondary shadow-field-drop text-body font-medium text-primary transition-colors hover:bg-fill-secondary-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/** Upstream's addable row trailer: "Add" (locally it copies the install command), then a kebab-sized spacer. */
function AddAction({pluginId, name}: {pluginId: string; name: string}) {
	const copyInstall = useCopyInstallCommand();
	return (
		<>
			<div data-testid="tabbed-list-item-row-action" className="flex items-center empty:hidden">
				<Tooltip content="Copy install command">
					<button
						type="button"
						aria-label={`Add ${name}`}
						onClick={() => void copyInstall(pluginId)}
						className={SECONDARY_CLASS}
					>
						Add
					</button>
				</Tooltip>
			</div>
			<div aria-hidden="true" data-testid="tabbed-list-row-menu-spacer" className="aspect-square h-8 shrink-0" />
		</>
	);
}

function hitActions(actions: UnifiedHitActions, name: string) {
	switch (actions?.kind) {
		case "skill":
			return <SkillRowActions skill={actions.skill} />;
		case "plugin":
			return (
				<PluginRowActions pluginId={actions.pluginId} name={actions.name} installPath={actions.installPath} />
			);
		case "add":
			return <AddAction pluginId={actions.pluginId} name={name} />;
		default:
			return undefined;
	}
}

interface HitSectionProps {
	id: string;
	testId: string;
	title: string;
	hits: readonly UnifiedHit[];
	limit: number;
	counterInset: boolean;
	rowTestId: string;
	onOpen: ((hit: UnifiedHit) => void) | undefined;
}

function HitSection({id, testId, title, hits, limit, counterInset, rowTestId, onOpen}: HitSectionProps) {
	const [expanded, setExpanded] = useState(false);
	const sectionRef = useRef<HTMLElement>(null);
	const collapsible = hits.length > limit;
	const shown = collapsible && !expanded ? hits.slice(0, limit) : hits;

	const toggle = () => {
		if (expanded) sectionRef.current?.firstElementChild?.scrollIntoView({block: "nearest"});
		setExpanded(!expanded);
	};

	const Caret = expanded ? ChevronUp : ChevronDown;
	const label = expanded ? "Show fewer" : `Show all ${numberFormat.format(hits.length)}`;

	return (
		<section ref={sectionRef} aria-labelledby={id} data-testid={testId} className={`flex flex-col gap-3 ${REVEAL}`}>
			<SectionHeader
				id={id}
				title={title}
				count={hits.length}
				comfortable
				counterInset={counterInset}
				{...(collapsible
					? {
							trailing: (
								<button
									type="button"
									aria-label={`${label}: ${title}`}
									aria-expanded={expanded}
									onClick={toggle}
									className={GHOST_SM_CLASS}
								>
									{label}
									<Caret aria-hidden="true" className="size-5 -me-1" />
								</button>
							),
						}
					: {})}
			/>
			<div className="flex flex-col">
				{shown.map((hit) => {
					const actions = hitActions(hit.actions, hit.name);
					return (
						<ListRow
							key={hit.key}
							testId={rowTestId}
							icon={KIND_ICON[hit.kind]}
							title={hit.name}
							kind={hit.kind}
							match={hit.match}
							verified={hit.verified}
							source={hit.byline}
							subtitle={hit.description}
							{...(actions === undefined ? {} : {actions})}
							{...(onOpen === undefined || hit.open === null
								? {}
								: {
										onView: () => {
											onOpen(hit);
										},
									})}
						/>
					);
				})}
			</div>
		</section>
	);
}

interface UnifiedSearchResultsProps {
	q: string;
	search: UnifiedSearch;
	/** The plugin catalog ("More you can add") is still loading. */
	catalogPending: boolean;
	/** The plugin catalog failed to load. */
	catalogError: boolean;
	onRetry: () => void;
	/** Retry is in flight. */
	retrying?: boolean;
	onOpen?: (hit: UnifiedHit) => void;
}

/**
 * Upstream's unified Customize search results (`Bd`): everything you have that
 * matches under "Yours", catalog plugins you could add under "More you can add".
 */
export function UnifiedSearchResults({
	q,
	search,
	catalogPending,
	catalogError,
	onRetry,
	retrying = false,
	onOpen,
}: UnifiedSearchResultsProps) {
	const term = q.trim();
	if (!searchTermReady(term)) {
		return (
			<p role="status" className="py-2 text-footnote text-muted-as-secondary">
				Keep typing to search everything you can add.
			</p>
		);
	}

	const total = search.yours.length + search.more.length;
	const quoted = `“${term}”`;
	const noMatch = total === 0 && !catalogPending && !catalogError;
	const status = catalogPending
		? ""
		: noMatch
			? `No results match ${quoted}`
			: `${numberFormat.format(total)} ${total === 1 ? "result" : "results"} matching ${quoted}`;

	return (
		<>
			<p role="status" className="sr-only">
				{status}
			</p>
			<div
				aria-busy={catalogPending || retrying}
				data-testid="customize-unified-search-results"
				className={`flex flex-col gap-7${catalogPending || retrying ? " opacity-70 pointer-events-none" : ""}`}
			>
				{catalogError && (
					<div className={`pb-2 ${REVEAL}`}>
						<div
							role="alert"
							className="flex items-start gap-2 rounded-card bg-[var(--upstream-bg-warning)] px-3 py-3 text-body text-upstream-warning shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--upstream-warning)_30%,transparent)]"
						>
							<TriangleAlert aria-hidden="true" className="size-5 shrink-0" />
							<div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-3 gap-y-2">
								<div className="max-w-full min-w-0 flex-auto">Couldn{"’"}t finish searching.</div>
								<button
									type="button"
									aria-busy={retrying || undefined}
									disabled={retrying}
									onClick={onRetry}
									className={GHOST_RETRY_CLASS}
								>
									Retry
								</button>
							</div>
						</div>
					</div>
				)}
				{search.yours.length > 0 && (
					<HitSection
						id="customize-unified-search-yours-header"
						testId="customize-unified-search-yours"
						title="Yours"
						hits={search.yours}
						limit={YOURS_LIMIT}
						counterInset={false}
						rowTestId="customize-list-row"
						onOpen={onOpen}
					/>
				)}
				{search.more.length > 0 && (
					<HitSection
						id="customize-unified-search-more-header"
						testId="customize-unified-search-more"
						title="More you can add"
						hits={search.more}
						limit={MORE_LIMIT}
						counterInset
						rowTestId="customize-unified-search-addable-hit-row"
						onOpen={onOpen}
					/>
				)}
				{catalogPending && search.more.length === 0 && (
					<div className="animate-[cds-fade-in_150ms_ease-out_500ms_backwards]">
						<CustomizeListRowsSkeleton />
					</div>
				)}
				{noMatch && <p className={`py-2 text-body text-secondary ${REVEAL}`}>No results match {quoted}</p>}
			</div>
		</>
	);
}
