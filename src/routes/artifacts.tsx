import {pageTitle} from "../lib/route-title";
import {createFileRoute, Link, useNavigate} from "@tanstack/react-router";
import {useSuspenseQuery} from "@tanstack/react-query";
import {Tabs} from "@base-ui/react/tabs";
import {
	Calendar,
	ChartColumn,
	CodeXml,
	EllipsisVertical,
	FileText,
	LayoutGrid,
	Link as LinkIcon,
	List,
	Lock,
	Map as MapIcon,
	Pin,
	SlidersVertical,
} from "lucide-react";
import {type ReactNode, useEffect, useId, useMemo, useState} from "react";
import {artifactsQueryOptions, type ArtifactSummary} from "../lib/api/artifacts";
import {
	activeFilterCount,
	applyArtifactFilters,
	ARTIFACT_OPENED_RANGES,
	ARTIFACT_OWNERS,
	ARTIFACT_SHARINGS,
	ARTIFACT_TYPE_KEYS,
	artifactInView,
	artifactMatchesSearch,
	artifactOpenedTimestamp,
	artifactSortTimestamp,
	artifactTimestamp,
	artifactTypeKey,
	formatArtifactRelative,
	formatArtifactTooltip,
	groupArtifactsByDate,
	NO_ARTIFACT_FILTERS,
	readArtifactsLayout,
	sortArtifacts,
	writeArtifactsLayout,
	type ArtifactFilters,
	type ArtifactKind,
	type ArtifactOpenedRange,
	type ArtifactOwner,
	type ArtifactSharing,
	type ArtifactSort,
	type ArtifactsLayout,
	type ArtifactTypeKey,
	type ArtifactView,
} from "../lib/artifact-gallery";
import {pinArtifact, unpinArtifact, useArtifactPins} from "../lib/artifact-pins";
import {writeClipboardText} from "../lib/clipboard";
import {formatCount} from "../lib/pluralize";
import {useToast} from "../components/toast-context";
import {TOOLBAR_ICON_BUTTON, ToolbarSearch} from "../components/toolbar-search";
import {
	ContextMenu,
	ContextMenuTrigger,
	Menu,
	MenuCheckboxItem,
	MenuContent,
	MenuItem,
	MenuLabel,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuSub,
	MenuSubContent,
	MenuSubTrigger,
	MenuTrigger,
} from "../components/ui/menu";
import {CodePageHeader} from "../components/code-page-header";
import {MakeSomethingNew} from "../components/make-something-new";
import {CDS_TAB_CLASS, CDS_TAB_LIST_CLASS} from "../components/ui/cds-tabs";
import {Tooltip} from "../components/ui/tooltip";

/** The gallery's URL state: upstream's `?search=` and `?tab=`, plus the local Filter and sort picks. */
interface ArtifactsSearch {
	search?: string;
	tab?: ArtifactTabParam;
	/** Comma list of Type keys (`docs,other`); a single `?type=docs` reads the same. */
	type?: string;
	/** The non-default sort; "Last opened" omits it. */
	sort?: "edited";
	/** Comma list of `me` / `others`. */
	owner?: string;
	opened?: Exclude<ArtifactOpenedRange, "any">;
	sharing?: Exclude<ArtifactSharing, "any">;
	pinned?: 1;
}

export const Route = createFileRoute("/artifacts")({
	component: ArtifactsPage,
	staticData: {pageGutter: "none"},
	validateSearch: (search: Record<string, unknown>): ArtifactsSearch => {
		const query = search["search"];
		const tab = tabParamFromSearch(search);
		const types = parseList(search["type"], ARTIFACT_TYPE_KEYS);
		const owners = parseList(search["owner"], ARTIFACT_OWNERS);
		const opened = search["opened"];
		const sharing = search["sharing"];
		const pinned = search["pinned"];
		return {
			...(typeof query === "string" && query !== "" ? {search: query} : {}),
			...(tab === undefined ? {} : {tab}),
			...(types.length === 0 ? {} : {type: types.join(",")}),
			...(search["sort"] === "edited" ? {sort: "edited" as const} : {}),
			...(owners.length === 0 ? {} : {owner: owners.join(",")}),
			...(isOneOf(opened, ARTIFACT_OPENED_RANGES) && opened !== "any" ? {opened} : {}),
			...(isOneOf(sharing, ARTIFACT_SHARINGS) && sharing !== "any" ? {sharing} : {}),
			...(pinned === 1 || pinned === "1" || pinned === true ? {pinned: 1 as const} : {}),
		};
	},
	loader: async ({context: {queryClient}}) => queryClient.query({...artifactsQueryOptions, staleTime: "static"}),
	head: () => ({
		meta: [{title: "Artifacts - Claude"}, pageTitle("Artifacts")],
	}),
});

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
	return options.some((option) => option === value);
}

/** A comma list param narrowed to known values, in the options' order, without repeats. */
function parseList<T extends string>(value: unknown, options: readonly T[]): T[] {
	if (typeof value !== "string") return [];
	const picked = new Set(value.split(","));
	return options.filter((option) => picked.has(option));
}

/** Upstream's `?tab=` values; All omits the param. */
type ArtifactTabParam = "mine" | "shared";

/** Reads `?tab=mine|shared`, falling back to the legacy `?view=yours|shared` so old links keep working. */
function tabParamFromSearch(search: Record<string, unknown>): ArtifactTabParam | undefined {
	const tab = search["tab"];
	if (tab === "mine" || tab === "shared") return tab;
	const view = search["view"];
	if (view === "yours") return "mine";
	if (view === "shared") return "shared";
	return undefined;
}

function viewFromTabParam(tab: ArtifactTabParam | undefined): ArtifactView {
	if (tab === "mine") return "yours";
	if (tab === "shared") return "shared";
	return "all";
}

function tabParamFromView(view: ArtifactView): ArtifactTabParam | undefined {
	if (view === "yours") return "mine";
	if (view === "shared") return "shared";
	return undefined;
}

function isArtifactView(value: unknown): value is ArtifactView {
	return VIEW_TABS.some((tab) => tab.view === value);
}

function filtersFromSearch(search: ArtifactsSearch): ArtifactFilters {
	return {
		types: parseList(search.type, ARTIFACT_TYPE_KEYS),
		owners: parseList(search.owner, ARTIFACT_OWNERS),
		opened: search.opened ?? "any",
		sharing: search.sharing ?? "any",
		pinned: search.pinned === 1,
	};
}

function searchFromState({
	search,
	view,
	filters,
	sort,
}: {
	search: string;
	view: ArtifactView;
	filters: ArtifactFilters;
	sort: ArtifactSort;
}): ArtifactsSearch {
	const tab = tabParamFromView(view);
	return {
		...(search === "" ? {} : {search}),
		...(tab === undefined ? {} : {tab}),
		...(filters.types.length === 0 ? {} : {type: filters.types.join(",")}),
		...(sort === "edited" ? {sort: "edited" as const} : {}),
		...(filters.owners.length === 0 ? {} : {owner: filters.owners.join(",")}),
		...(filters.opened === "any" ? {} : {opened: filters.opened}),
		...(filters.sharing === "any" ? {} : {sharing: filters.sharing}),
		...(filters.pinned ? {pinned: 1 as const} : {}),
	};
}

/** Upstream's type vocabulary: anything that is not a Doc (or a Slides/Design type we never see) is "Other". */
const TYPE_LABELS: Record<ArtifactTypeKey, string> = {
	dashboard: "Dashboard",
	design: "Design",
	"design-system": "Design System",
	docs: "Docs",
	slides: "Slides",
	other: "Other",
};

const OWNER_LABELS: Record<ArtifactOwner, string> = {me: "You", others: "Other people"};

const SORT_LABELS: Record<ArtifactSort, string> = {opened: "Last opened", edited: "Last edited"};

const OPENED_LABELS: Record<ArtifactOpenedRange, string> = {
	any: "Any time",
	today: "Today",
	yesterday: "Yesterday",
	week: "Past 7 days",
	month: "Past 30 days",
};

const SHARING_LABELS: Record<ArtifactSharing, string> = {any: "Any", private: "Only you", shared: "Shared"};

/** Upstream's Owner note on the tabs that already fix the owner. */
const OWNER_TAB_NOTES: Partial<Record<ArtifactView, string>> = {
	yours: "This tab lists only your own artifacts.",
	shared: "This tab lists only other people’s artifacts.",
};

const VIEW_TABS: ReadonlyArray<{view: ArtifactView; label: string}> = [
	{view: "all", label: "All"},
	{view: "yours", label: "Yours"},
	{view: "shared", label: "Shared with you"},
];

/** Upstream's EmptyState copy per tab (bundle `Rr` for Shared, `Lr` for Yours; Lr's "New artifact" CTA is cloud-only). */
const EMPTY_STATE_COPY: Record<ArtifactView, {headline: string; description: string}> = {
	all: {headline: "No artifacts yet", description: "Artifacts that Claude publishes in your sessions appear here."},
	yours: {headline: "Create your first artifact", description: "Artifacts you build with Claude appear here."},
	shared: {
		headline: "No shared artifacts yet",
		description: "When someone shares an artifact with you, it appears here.",
	},
};

/** Upstream's left-aligned cds EmptyState (`hideIllustration`, align start). */
function ArtifactsEmptyState({view}: {view: ArtifactView}) {
	const {headline, description} = EMPTY_STATE_COPY[view];
	return (
		<div className="flex flex-col items-start gap-3 pb-12 text-start text-body">
			<h3 className="max-w-xs font-medium text-secondary">{headline}</h3>
			<p className="max-w-xs text-footnote text-secondary">{description}</p>
		</div>
	);
}

/** Upstream's cds Page content box (`mx-auto w-full px-md md:px-8 max-w-5xl`), shared by the sticky header and the list. */
const ARTIFACTS_BOX_CLASS = "mx-auto w-full max-w-5xl px-2 md:px-8";

/** Upstream's Owner/Type multi-pick summary: "Any" (or "Anyone"), the one label, or "{n} picked". */
function pickedSummary<T extends string>(picked: readonly T[], labels: Record<T, string>, none: string): string {
	const [only] = picked;
	if (only === undefined) return none;
	return picked.length === 1 ? labels[only] : `${picked.length} picked`;
}

function toggled<T>(list: readonly T[], value: T, on: boolean): T[] {
	return on ? [...list.filter((item) => item !== value), value] : list.filter((item) => item !== value);
}

function ArtifactsPage() {
	const {data: artifacts} = useSuspenseQuery(artifactsQueryOptions);
	const params = Route.useSearch();
	const {search = "", tab: tabParam} = params;
	const view = viewFromTabParam(tabParam);
	const filters = filtersFromSearch(params);
	const sort: ArtifactSort = params.sort ?? "opened";
	const navigate = useNavigate();
	const [layout, setLayout] = useState<ArtifactsLayout>("grid");
	const [searchOpen, setSearchOpen] = useState(false);
	const [sortLanded, setSortLanded] = useState(false);
	const now = useMemo(() => new Date(), []);
	const {isPinned} = useArtifactPins();

	useEffect(() => {
		setLayout(readArtifactsLayout());
	}, []);

	const inView = useMemo(
		() => artifacts.filter((artifact) => artifactInView(artifact.audience, view)),
		[artifacts, view],
	);
	// The Owner picks only apply on All; Yours and Shared already fix the owner.
	const applied = view === "all" ? filters : {...filters, owners: []};
	const visible = sortArtifacts(
		applyArtifactFilters(
			inView.filter((artifact) => artifactMatchesSearch(artifact.title, search)),
			applied,
			{now, isPinned: (artifact) => isPinned(artifact.url)},
		),
		sort,
	);
	// Upstream's note: pinned artifacts are always sorted by Last edited.
	const pinned = sortArtifacts(
		visible.filter((artifact) => isPinned(artifact.url)),
		"edited",
	);
	const unpinned = visible.filter((artifact) => !isPinned(artifact.url));
	const searching = search.trim() !== "";
	const layoutLabel = layout === "grid" ? "List view" : "Grid view";

	function toggleLayout() {
		const next: ArtifactsLayout = layout === "grid" ? "list" : "grid";
		setLayout(next);
		writeArtifactsLayout(next);
	}

	function updateSearch(
		next: Partial<{search: string; view: ArtifactView; filters: ArtifactFilters; sort: ArtifactSort}>,
	) {
		void navigate({
			to: "/artifacts",
			search: searchFromState({search, view, filters, sort, ...next}),
			replace: true,
		});
	}

	let status = "";
	if (searching) {
		status =
			visible.length === 0
				? `No artifacts match “${search}”`
				: `${formatCount(visible.length, "artifact")} matching “${search}”`;
	} else if (sortLanded) {
		status = `Sorted by ${SORT_LABELS[sort]}`;
	}

	return (
		<div data-cds="Page" data-width="content" className="flex w-full flex-col">
			<CodePageHeader
				title="Artifacts"
				sticky={{box: ARTIFACTS_BOX_CLASS}}
				searchOpen={searchOpen}
				tabs={
					<Tabs.Root
						data-cds="Tabs"
						value={view}
						onValueChange={(next: unknown) => {
							if (isArtifactView(next)) updateSearch({view: next});
						}}
					>
						<Tabs.List activateOnFocus={false} aria-label="Artifacts" className={CDS_TAB_LIST_CLASS}>
							{VIEW_TABS.map((tab) => (
								<Tabs.Tab key={tab.view} value={tab.view} className={CDS_TAB_CLASS}>
									{tab.label}
								</Tabs.Tab>
							))}
						</Tabs.List>
					</Tabs.Root>
				}
				toolbar={
					<>
						<ToolbarSearch
							label="Search your artifacts"
							placeholder="Search artifacts..."
							search={search}
							onOpenChange={setSearchOpen}
							onSearch={(next) => {
								updateSearch({search: next});
							}}
						/>
						<ArtifactFilterMenu
							artifacts={inView}
							view={view}
							filters={filters}
							sort={sort}
							onFilters={(next) => {
								updateSearch({filters: next});
							}}
							onSort={(next) => {
								setSortLanded(true);
								updateSearch({sort: next});
							}}
						/>
						<Tooltip content={layoutLabel}>
							<button
								type="button"
								className={TOOLBAR_ICON_BUTTON}
								aria-label={layoutLabel}
								onClick={toggleLayout}
							>
								{layout === "grid" ? <List aria-hidden="true" /> : <LayoutGrid aria-hidden="true" />}
							</button>
						</Tooltip>
					</>
				}
			>
				<p role="status" className="sr-only">
					{status}
				</p>
			</CodePageHeader>

			<div className={`${ARTIFACTS_BOX_CLASS} flex flex-col pb-12 pt-1`}>
				<MakeSomethingNew />
				{inView.length === 0 && (artifacts.length === 0 || !searching) ? (
					<ArtifactsEmptyState view={view} />
				) : visible.length === 0 ? (
					searching ? (
						<div className="mt-10 flex flex-col items-center gap-3">
							<div role="status" className="text-center text-body text-ink-muted">
								{`No artifacts matching “${search}”`}
							</div>
						</div>
					) : (
						<div className="mt-10 flex flex-col items-center gap-3 text-body text-muted-as-secondary">
							<span role="status">Nothing matches. Try clearing a filter.</span>
							<button
								type="button"
								className={FILTER_EMPTY_CLEAR_CLASS}
								onClick={() => {
									updateSearch({filters: NO_ARTIFACT_FILTERS});
								}}
							>
								Clear filters
							</button>
						</div>
					)
				) : layout === "grid" ? (
					<ArtifactGrid pinned={pinned} artifacts={unpinned} now={now} />
				) : (
					<ArtifactList pinned={pinned} artifacts={unpinned} now={now} sort={sort} />
				)}
			</div>
		</div>
	);
}

/**
 * Upstream's cds Button `variant="secondary"` at the gallery's comfortable density (28px, 9px padding, 8px radius,
 * the filled secondary with the field ring) under the filter-empty copy (gated `On`).
 */
const FILTER_EMPTY_CLEAR_CLASS =
	"inline-flex h-7 shrink-0 items-center justify-center rounded-r6 px-[9px] text-body text-primary bg-fill-secondary shadow-[inset_0_0_0_1px_var(--color-border),0_1px_2px_rgb(0_0_0/0.05)] transition-shadow hover:bg-fill-secondary-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/**
 * Upstream's "Filter and sort" menu (bundle `Dn`): Sort by, then Owner / Type / Date opened / Sharing submenus,
 * the Pinned checkbox and, while any filter is on, Clear filters. Locally Owner and Sharing both read the
 * indexed audience, and only Docs and Other ever count, since the other types never index.
 */
function ArtifactFilterMenu({
	artifacts,
	view,
	filters,
	sort,
	onFilters,
	onSort,
}: {
	artifacts: readonly ArtifactSummary[];
	view: ArtifactView;
	filters: ArtifactFilters;
	sort: ArtifactSort;
	onFilters: (next: ArtifactFilters) => void;
	onSort: (next: ArtifactSort) => void;
}) {
	const count = activeFilterCount(filters);
	const label = count === 0 ? "Filter and sort" : `${count} ${count === 1 ? "filter" : "filters"} on`;
	const countOf = (key: ArtifactTypeKey) =>
		artifacts.filter((artifact) => artifactTypeKey(artifact.kind) === key).length;
	const ownerNote = OWNER_TAB_NOTES[view];
	return (
		<Menu>
			<Tooltip content={label}>
				<MenuTrigger className={TOOLBAR_ICON_BUTTON} aria-label={label} aria-pressed={count > 0}>
					<SlidersVertical aria-hidden="true" />
				</MenuTrigger>
			</Tooltip>
			<MenuContent align="end" className="max-w-[320px]">
				<MenuSub>
					<MenuSubTrigger value={SORT_LABELS[sort]}>Sort by</MenuSubTrigger>
					<MenuSubContent>
						<MenuRadioGroup
							value={sort}
							onValueChange={(next: unknown) => {
								if (next === "opened" || next === "edited") onSort(next);
							}}
						>
							{(["opened", "edited"] as const).map((option) => (
								<MenuRadioItem key={option} value={option}>
									{SORT_LABELS[option]}
								</MenuRadioItem>
							))}
						</MenuRadioGroup>
					</MenuSubContent>
				</MenuSub>
				<MenuSeparator />
				<MenuSub>
					<MenuSubTrigger value={pickedSummary(filters.owners, OWNER_LABELS, "Anyone")}>Owner</MenuSubTrigger>
					<MenuSubContent>
						{ownerNote === undefined ? (
							ARTIFACT_OWNERS.map((owner) => (
								<MenuCheckboxItem
									key={owner}
									leadingCheck
									checked={filters.owners.includes(owner)}
									onCheckedChange={(checked) => {
										onFilters({...filters, owners: toggled(filters.owners, owner, checked)});
									}}
								>
									{OWNER_LABELS[owner]}
								</MenuCheckboxItem>
							))
						) : (
							<MenuLabel className="max-w-[240px] px-2.5 py-1.5 text-footnote text-ink-muted">
								{ownerNote}
							</MenuLabel>
						)}
					</MenuSubContent>
				</MenuSub>
				<MenuSub>
					<MenuSubTrigger value={pickedSummary(filters.types, TYPE_LABELS, "Any")}>Type</MenuSubTrigger>
					<MenuSubContent>
						{ARTIFACT_TYPE_KEYS.map((key) => {
							const total = countOf(key);
							return (
								<MenuCheckboxItem
									key={key}
									leadingCheck
									checked={filters.types.includes(key)}
									{...(total > 0 ? {hint: total} : {})}
									onCheckedChange={(checked) => {
										onFilters({...filters, types: toggled(filters.types, key, checked)});
									}}
								>
									{TYPE_LABELS[key]}
								</MenuCheckboxItem>
							);
						})}
					</MenuSubContent>
				</MenuSub>
				<MenuSub>
					<MenuSubTrigger value={OPENED_LABELS[filters.opened]}>Date opened</MenuSubTrigger>
					<MenuSubContent>
						<MenuRadioGroup
							value={filters.opened}
							onValueChange={(next: unknown) => {
								if (isOneOf(next, ARTIFACT_OPENED_RANGES)) onFilters({...filters, opened: next});
							}}
						>
							{ARTIFACT_OPENED_RANGES.map((range) => (
								<MenuRadioItem key={range} value={range}>
									{OPENED_LABELS[range]}
								</MenuRadioItem>
							))}
						</MenuRadioGroup>
					</MenuSubContent>
				</MenuSub>
				<MenuSub>
					<MenuSubTrigger value={SHARING_LABELS[filters.sharing]}>Sharing</MenuSubTrigger>
					<MenuSubContent>
						<MenuRadioGroup
							value={filters.sharing}
							onValueChange={(next: unknown) => {
								if (isOneOf(next, ARTIFACT_SHARINGS)) onFilters({...filters, sharing: next});
							}}
						>
							{ARTIFACT_SHARINGS.map((sharing) => (
								<MenuRadioItem
									key={sharing}
									value={sharing}
									disabled={sharing === "private" && view === "shared"}
									disabledReason="This applies to your own artifacts only."
								>
									{SHARING_LABELS[sharing]}
								</MenuRadioItem>
							))}
						</MenuRadioGroup>
					</MenuSubContent>
				</MenuSub>
				<MenuSeparator />
				<MenuCheckboxItem
					checked={filters.pinned}
					onCheckedChange={(checked) => {
						onFilters({...filters, pinned: checked});
					}}
				>
					Pinned
				</MenuCheckboxItem>
				{count > 0 && (
					<>
						<MenuSeparator />
						<MenuItem
							onSelect={() => {
								onFilters(NO_ARTIFACT_FILTERS);
							}}
						>
							Clear filters
						</MenuItem>
					</>
				)}
			</MenuContent>
		</Menu>
	);
}

const TILE_BOX = "size-9 rounded-lg";
const TILE_ICON = "size-5";

/** The publish's icon word → its glyph; any other word falls back to the artifact's kind. */
const TYPE_MEDIA_ICONS = {
	chart: ChartColumn,
	doc: FileText,
	code: CodeXml,
	map: MapIcon,
	calendar: Calendar,
} as const;

type TypeMediaIconWord = keyof typeof TYPE_MEDIA_ICONS;

function isTypeMediaIconWord(word: string): word is TypeMediaIconWord {
	return Object.hasOwn(TYPE_MEDIA_ICONS, word);
}

function typeMediaIconWord(artifact: ArtifactSummary): TypeMediaIconWord {
	const {icon} = artifact;
	if (icon !== null && isTypeMediaIconWord(icon)) return icon;
	return artifact.kind === "docs" ? "doc" : "code";
}

/** Upstream's cover and mark kinds: Docs draw a `document`, everything else a `file`. */
type CoverKind = "file" | "document";

function coverKind(kind: ArtifactKind): CoverKind {
	return kind === "docs" ? "document" : "file";
}

/** Upstream's cover tints (`--cds-<hue>-100/600`, dark `-700/200`). */
const COVER_HUE: Record<CoverKind, string> = {
	file: "bg-cds-gray-100 text-cds-gray-600 dark:bg-cds-gray-700 dark:text-cds-gray-200",
	document: "bg-cds-blue-100 text-cds-blue-600 dark:bg-cds-blue-700 dark:text-cds-blue-200",
};

const COVER_FRONT_SIZE: Record<CoverKind, string> = {
	file: "h-[190px] w-[min(232px,100%-24px)]",
	document: "h-[200px] w-[182px]",
};

/** Upstream's bottom fade (`he`): an eased 16-stop ramp from clear at 67% to 30% of the cover hue, with 12px side fades. */
const COVER_FADE_EASING = [
	0, 0.013, 0.049, 0.104, 0.175, 0.259, 0.352, 0.45, 0.55, 0.648, 0.741, 0.825, 0.896, 0.951, 0.987, 1,
];
const COVER_FADE_MASK = {
	maskImage: [
		`linear-gradient(to bottom, transparent, ${COVER_FADE_EASING.map(
			(step, index) => `rgb(0 0 0 / ${(step * 0.3).toFixed(3)}) ${(67 + index * 2.2).toFixed(1)}%`,
		).join(", ")})`,
		"linear-gradient(to right, transparent, #000 12px, #000 calc(100% - 12px), transparent)",
	].join(", "),
	maskComposite: "intersect",
} as const;

/** Upstream's cover wash: the surface laid over the hue at 40% (35% dark), on the cover and again inside its fade. */
const COVER_SURFACE_WASH = "absolute inset-0 bg-surface-2 opacity-40 dark:opacity-35";

/** An upstream blank-drawing box: `[x, y, width, height, rx?]`, where a missing rx rounds it into a pill. */
type BlankBox = readonly [x: number, y: number, width: number, height: number, rx?: number];

/** Upstream's blank drawings (`M` in c8a1f083a): the `other` 3 × 2 tile grid and the `document` page's text lines. */
const BLANK_DRAWINGS: Record<CoverKind, {width: number; boxes: readonly BlankBox[]}> = {
	file: {
		width: 202,
		boxes: [0, 1, 2, 3, 4, 5].map((index): BlankBox => [
			16 + (index % 3) * 59.33,
			index < 3 ? 16 : 98,
			51.33,
			74,
			6,
		]),
	},
	document: {
		width: 180,
		boxes: [
			[18, 18, 92, 10],
			[18, 36, 55, 6],
			[18, 54, 132.5, 5],
			[18, 67, 121, 5],
			[18, 80, 126.5, 5],
			[18, 95, 144, 30, 6],
		],
	},
};

function BlankBoxes({boxes}: {boxes: readonly BlankBox[]}) {
	return boxes.map(([x, y, width, height, rx]) => (
		<rect key={`${x} ${y}`} x={x} y={y} width={width} height={height} rx={rx ?? Math.min(width, height) / 2} />
	));
}

const SHEEN_STOP = "[stop-color:currentColor]";

/**
 * Upstream's no-thumbnail front sheet (`R`): the skeleton drawing pinned to the sheet's top centre, overflowing its
 * 130px box, with a second copy filled by a sheen that fades from the skeleton ink to clear across its width.
 */
function CoverBlank({kind}: {kind: CoverKind}) {
	const sheenId = useId();
	const {width, boxes} = BLANK_DRAWINGS[kind];
	return (
		<svg
			aria-hidden="true"
			data-artifact-cover-blank={kind === "file" ? "other" : "document"}
			width={width}
			height={130}
			viewBox={`0 0 ${width} 130`}
			className="pointer-events-none absolute top-0 overflow-visible fill-current start-1/2 -translate-x-1/2 rtl:translate-x-1/2 text-[color:var(--skeleton-base)]"
		>
			<defs>
				<linearGradient id={sheenId} gradientUnits="userSpaceOnUse" x1={0} x2={width} y1={0} y2={0}>
					<stop offset={0} className={SHEEN_STOP} />
					<stop offset={1} className={SHEEN_STOP} stopOpacity={0} />
				</linearGradient>
			</defs>
			<g>
				<BlankBoxes boxes={boxes} />
			</g>
			<g fill={`url(#${sheenId})`}>
				<BlankBoxes boxes={boxes} />
			</g>
		</svg>
	);
}

/** Upstream's card cover: a tinted wash with a floating front sheet and a masked bottom fade. */
function ArtifactCover({kind}: {kind: CoverKind}) {
	return (
		<div
			data-artifact-cover={kind}
			className={`group/cover relative h-full overflow-hidden isolate ${COVER_HUE[kind]}`}
		>
			<div className={COVER_SURFACE_WASH} />
			<div
				data-cover-front=""
				className={`absolute inset-x-0 mx-auto overflow-hidden border border-[color:var(--color-border-line)] bg-white bg-clip-padding text-primary dark:bg-surface-1 isolate shadow-lg top-[30px] z-2 rounded-xl ${COVER_FRONT_SIZE[kind]}`}
			>
				<CoverBlank kind={kind} />
			</div>
			<div
				aria-hidden="true"
				className={`pointer-events-none absolute inset-0 isolate z-3 mx-auto max-w-[268px] overflow-hidden ${COVER_HUE[kind]}`}
				style={COVER_FADE_MASK}
			>
				<div className={COVER_SURFACE_WASH} />
			</div>
		</div>
	);
}

/** Upstream's card-size ArtifactMark: a 40px r8 tile, neutral for files and tint-blue for documents. */
function ArtifactMark({artifact}: {artifact: ArtifactSummary}) {
	const kind = coverKind(artifact.kind);
	const word = typeMediaIconWord(artifact);
	const Icon = TYPE_MEDIA_ICONS[word];
	const tone = kind === "document" ? "bg-upstream-tint-blue text-tint-blue-ink" : "bg-fill-secondary text-secondary";
	return (
		<span
			data-artifact-mark={kind}
			data-artifact-mark-size="card"
			className={`flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg ${tone}`}
		>
			<Icon aria-hidden="true" data-icon={word} className="size-5" />
		</span>
	);
}

/**
 * Upstream's type tile: a neutral `</>` tile for HTML pages ("Other") and a blue document tile for Docs.
 * 36px in list rows.
 */
function TypeTile({kind}: {kind: ArtifactKind}) {
	const Icon = kind === "docs" ? FileText : CodeXml;
	const tone = kind === "docs" ? "bg-blue-500/10 text-blue-600 dark:text-blue-300" : "bg-alpha-1 text-secondary";
	return (
		<div
			{...(kind === "docs" ? {role: "img", "aria-label": "Docs"} : {"aria-hidden": true})}
			data-type-tile={kind}
			className={`flex shrink-0 items-center justify-center overflow-hidden ${TILE_BOX} ${tone}`}
		>
			<Icon aria-hidden="true" className={TILE_ICON} />
		</div>
	);
}

function RelativeTime({ms, now}: {ms: number; now: Date}) {
	return (
		<Tooltip content={formatArtifactTooltip(ms)} className="pointer-events-auto">
			<time data-cds="RelativeTime" dateTime={new Date(ms).toISOString()}>
				{formatArtifactRelative(ms, now)}
			</time>
		</Tooltip>
	);
}

/** The list row's lock, dot and "Edited/Viewed <t>" (list rows keep them until list view is re-verified). */
function PrivacyAndDate({artifact, now}: {artifact: ArtifactSummary; now: Date}) {
	const ms = artifactTimestamp(artifact);
	return (
		<>
			{artifact.audience === "owner" && (
				<>
					<Tooltip content="Private" className="pointer-events-auto shrink-0">
						<span role="img" aria-label="Private" className="flex shrink-0 items-center">
							<Lock aria-hidden="true" className="size-3.5" />
						</span>
					</Tooltip>
					<span aria-hidden="true" className="inline-block size-[3px] shrink-0 rounded-full bg-alpha-3" />
				</>
			)}
			<span data-artifact-meta="">
				{artifact.lastPublishedAt === null ? "Viewed" : "Edited"} <RelativeTime ms={ms} now={now} />
			</span>
		</>
	);
}

/** Upstream's card meta: "Opened <t>", else "Edited <publish>", else "Created <first seen>". */
function cardMetaTime(artifact: ArtifactSummary): {verb: string; ms: number} {
	if (artifact.lastOpenedAt !== null) return {verb: "Opened", ms: artifact.lastOpenedAt};
	if (artifact.lastPublishedAt !== null) return {verb: "Edited", ms: artifact.lastPublishedAt};
	return {verb: "Created", ms: artifact.firstSeenAt};
}

function ArtifactChips({artifact}: {artifact: ArtifactSummary}) {
	const chip =
		"pointer-events-auto rounded-full border border-border px-2 py-0.5 text-caption text-secondary no-underline transition-colors hover:bg-fill-ghost-hover hover:text-primary";
	return (
		<>
			<Link to="/session/$id" params={{id: artifact.sessionId}} className={chip}>
				Session
			</Link>
			{artifact.sourceExists && (
				<Link to="/artifact/$id" params={{id: artifact.id}} className={chip}>
					Preview
				</Link>
			)}
		</>
	);
}

function PrimaryLink({artifact, className}: {artifact: ArtifactSummary; className: string}) {
	return (
		<a
			href={artifact.url}
			target="_blank"
			rel="noopener noreferrer"
			data-primary="true"
			aria-label={artifact.title}
			className={`absolute inset-0 outline-none hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus ${className}`}
		/>
	);
}

const ROW_ACTION_CLASS =
	"pointer-events-auto flex size-6 shrink-0 items-center justify-center rounded-r6 text-ink-muted opacity-0 transition-opacity hover:bg-fill-ghost-hover hover:text-primary focus-visible:opacity-100 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus group-hover/cdsrow:opacity-100 group-has-[:focus-visible]/cdsrow:opacity-100 data-[popup-open]:opacity-100 data-[popup-open]:bg-fill-ghost-hover pointer-coarse:opacity-100";

function useCopyArtifactLink() {
	const toast = useToast();
	return async (artifact: ArtifactSummary) => {
		const copied = await writeClipboardText(artifact.url);
		toast(
			copied
				? {kind: "success", message: "Link copied to clipboard."}
				: {kind: "error", message: "Couldn’t copy the link. Try again."},
		);
	};
}

function togglePin(artifact: ArtifactSummary, pinned: boolean): void {
	if (pinned) unpinArtifact(artifact.url);
	else pinArtifact(artifact.url);
}

/** Upstream's row menu within local limits (Rename, Duplicate and Delete are cloud mutations), with its P / C keycaps. */
function ArtifactMenuItems({artifact, pinned}: {artifact: ArtifactSummary; pinned: boolean}) {
	const copyLink = useCopyArtifactLink();
	return (
		<>
			<MenuItem
				icon={pinned ? <Pin aria-hidden="true" fill="currentColor" /> : <Pin aria-hidden="true" />}
				accelerator="p"
				data-artifact-row="pin"
				onSelect={() => {
					togglePin(artifact, pinned);
				}}
			>
				{pinned ? "Unpin" : "Pin"}
			</MenuItem>
			<MenuItem
				icon={<LinkIcon aria-hidden="true" />}
				accelerator="c"
				data-artifact-row="copy_link"
				onSelect={() => void copyLink(artifact)}
			>
				Copy link
			</MenuItem>
		</>
	);
}

function ArtifactPinButton({
	artifact,
	pinned,
	className = ROW_ACTION_CLASS,
}: {
	artifact: ArtifactSummary;
	pinned: boolean;
	className?: string;
}) {
	const pinLabel = pinned ? "Unpin" : "Pin";
	return (
		<Tooltip content={pinLabel}>
			<button
				type="button"
				aria-label={pinLabel}
				aria-pressed={pinned}
				className={className}
				onClick={() => {
					togglePin(artifact, pinned);
				}}
			>
				<Pin aria-hidden="true" className="size-4" {...(pinned ? {fill: "currentColor"} : {})} />
			</button>
		</Tooltip>
	);
}

/** Upstream's on-content card button seat: revealed on hover, focus within, an open menu and touch. */
const CARD_ACTION_SEAT_CLASS =
	"relative flex shrink-0 rounded-r5 opacity-0 transition-opacity group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 group-has-[[aria-expanded=true]]:opacity-100 touch:opacity-100 data-[pin-at-rest=shown]:opacity-100";

/** Upstream's blurred on-content button paint (`--cds-button-on-content`, its hover and inset ring). */
const CARD_ACTION_BUTTON_CLASS =
	"pointer-events-auto relative flex size-6 shrink-0 items-center justify-center rounded-r5 text-primary backdrop-blur-md bg-button-on-content shadow-[inset_0_0_0_1px_var(--color-button-on-content-ring)] hover:bg-button-on-content-hover hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

/** Upstream's card/row More menu sits 6px off its trigger. */
const ARTIFACT_MENU_OFFSET = 6;

function ArtifactMoreMenu({
	artifact,
	pinned,
	className = ROW_ACTION_CLASS,
}: {
	artifact: ArtifactSummary;
	pinned: boolean;
	className?: string;
}) {
	return (
		<Menu>
			<MenuTrigger aria-label={`More options for ${artifact.title}`} className={className}>
				<EllipsisVertical aria-hidden="true" className="size-4" />
			</MenuTrigger>
			<MenuContent align="end" sideOffset={ARTIFACT_MENU_OFFSET}>
				<ArtifactMenuItems artifact={artifact} pinned={pinned} />
			</MenuContent>
		</Menu>
	);
}

/** The hover Pin button and the "More options" ⋮ menu at the end of an artifact row. */
function ArtifactRowActions({artifact, pinned}: {artifact: ArtifactSummary; pinned: boolean}) {
	return (
		<span className="flex shrink-0 items-center gap-0.5">
			<ArtifactPinButton artifact={artifact} pinned={pinned} />
			<ArtifactMoreMenu artifact={artifact} pinned={pinned} />
		</span>
	);
}

/** Right-click on a row or card opens the same items as its ⋮ menu. */
function ArtifactContextMenu({
	artifact,
	pinned,
	children,
}: {
	artifact: ArtifactSummary;
	pinned: boolean;
	children: ReactNode;
}) {
	return (
		<ContextMenu>
			<ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
			<MenuContent>
				<ArtifactMenuItems artifact={artifact} pinned={pinned} />
			</MenuContent>
		</ContextMenu>
	);
}

function ArtifactList({
	pinned,
	artifacts,
	now,
	sort,
}: {
	pinned: ArtifactSummary[];
	artifacts: ArtifactSummary[];
	now: Date;
	sort: ArtifactSort;
}) {
	const idPrefix = useId();
	const timestamp =
		sort === "opened"
			? artifactOpenedTimestamp
			: (artifact: ArtifactSummary) => artifactSortTimestamp(artifact, sort);
	const groups = [
		...(pinned.length > 0 ? [{label: "Pinned", items: pinned, pinned: true}] : []),
		...groupArtifactsByDate(artifacts, now, timestamp).map((group) => ({...group, pinned: false})),
	];
	return (
		<div className="-mx-3 flex flex-col gap-3">
			{groups.map((group, index) => {
				const headingId = `${idPrefix}-group-${index}`;
				return (
					<section key={group.label} className="flex flex-col">
						<h2 id={headingId} className="px-3 py-1 text-caption font-medium text-ink-muted">
							{group.label}
						</h2>
						<ul role="list" aria-labelledby={headingId} className="flex flex-col">
							{group.items.map((artifact) => (
								<li key={artifact.url} data-gallery-card="" className="group/cdsrow relative">
									<ArtifactContextMenu artifact={artifact} pinned={group.pinned}>
										<PrimaryLink artifact={artifact} className="rounded" />
										<div className="pointer-events-none grid grid-cols-[2.25rem_minmax(0,1fr)_max-content] items-center gap-x-3 rounded px-3 py-1 group-hover/cdsrow:bg-fill-ghost-hover group-has-[:focus-visible]/cdsrow:bg-fill-ghost-hover">
											<TypeTile kind={artifact.kind} />
											<div className="flex min-h-10 min-w-0 flex-col justify-center gap-0.5 sm:pr-8">
												<span
													aria-hidden="true"
													className="min-w-0 truncate text-body text-primary"
												>
													{artifact.title}
												</span>
											</div>
											<div className="flex min-w-0 items-center justify-end gap-1.5 whitespace-nowrap text-footnote tabular-nums text-secondary">
												<ArtifactChips artifact={artifact} />
												<span className="hidden items-center gap-1 sm:flex">
													<PrivacyAndDate artifact={artifact} now={now} />
												</span>
												<ArtifactRowActions artifact={artifact} pinned={group.pinned} />
											</div>
										</div>
									</ArtifactContextMenu>
								</li>
							))}
						</ul>
					</section>
				);
			})}
		</div>
	);
}

/** Upstream's grid (bundle `kt`): once anything is pinned it splits into "Pinned" and "Other artifacts" sections. */
function ArtifactGrid({pinned, artifacts, now}: {pinned: ArtifactSummary[]; artifacts: ArtifactSummary[]; now: Date}) {
	const idPrefix = useId();
	if (pinned.length === 0) return <ArtifactCardList artifacts={artifacts} now={now} pinned={false} />;
	const sections = [
		{label: "Pinned", items: pinned, pinned: true},
		...(artifacts.length > 0 ? [{label: "Other artifacts", items: artifacts, pinned: false}] : []),
	];
	return (
		<div className="flex flex-col gap-9">
			{sections.map((section, index) => {
				const headingId = `${idPrefix}-section-${index}`;
				return (
					<section key={section.label} className="flex flex-col gap-2">
						<h2 id={headingId} className="px-0 py-1 text-caption font-medium text-ink-muted">
							{section.label}
						</h2>
						<ArtifactCardList
							artifacts={section.items}
							now={now}
							pinned={section.pinned}
							labelledBy={headingId}
						/>
					</section>
				);
			})}
		</div>
	);
}

function ArtifactCardList({
	artifacts,
	now,
	pinned,
	labelledBy,
}: {
	artifacts: ArtifactSummary[];
	now: Date;
	pinned: boolean;
	labelledBy?: string;
}) {
	return (
		<ul
			role="list"
			aria-labelledby={labelledBy}
			className="grid @container gap-6 grid-cols-[repeat(auto-fill,minmax(min(100%,max(15rem,30%)),1fr))]"
		>
			{artifacts.map((artifact) => (
				<ArtifactCard key={artifact.url} artifact={artifact} now={now} pinned={pinned} />
			))}
		</ul>
	);
}

/**
 * Upstream's grid card: the whole card grows to 103% on hover (and while its menu is open) around an r16
 * pressable holding the tinted cover and the 72px mark row; More and Pin float top-right over the cover.
 */
function ArtifactCard({artifact, now, pinned}: {artifact: ArtifactSummary; now: Date; pinned: boolean}) {
	const {verb, ms} = cardMetaTime(artifact);
	return (
		<li className="h-full">
			<ArtifactContextMenu artifact={artifact} pinned={pinned}>
				<div
					data-card-grows=""
					className="group relative h-full transition-transform duration-200 ease-[cubic-bezier(0.165,0.84,0.44,1)] motion-safe:hover:scale-[1.03] motion-safe:has-[[aria-expanded=true]]:scale-[1.03]"
				>
					{/* Upstream's pressable: shrinks to 98% over duration-snap (120ms) while pressed. */}
					<div
						data-gallery-card=""
						className="relative block w-full group/card transition-transform duration-[120ms] active:scale-[0.98] rounded-2xl h-full"
					>
						<PrimaryLink artifact={artifact} className="rounded-2xl" />
						<div
							data-card-frame=""
							className="pointer-events-none relative flex h-full flex-col overflow-hidden rounded-2xl bg-surface-2 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-card-ring"
						>
							<div
								data-card-preview=""
								className="relative h-[152px] shrink-0 select-none overflow-hidden"
							>
								<ArtifactCover kind={coverKind(artifact.kind)} />
							</div>
							<div data-card-body="" className="relative flex min-h-18 flex-1 items-center gap-3 p-4">
								<div aria-hidden="true">
									<ArtifactMark artifact={artifact} />
								</div>
								<div data-artifact-mark-words="" className="flex min-w-0 flex-1 flex-col gap-0.5">
									<div className="flex items-start gap-2">
										<div
											aria-hidden="true"
											data-card-title=""
											className="min-w-0 truncate text-start text-body font-control leading-5 text-primary"
										>
											{artifact.title}
										</div>
									</div>
									<div
										data-card-meta=""
										className="mt-auto flex items-center gap-1 text-caption text-muted-as-secondary"
									>
										<span
											data-artifact-meta=""
											className="pointer-events-auto min-w-0 overflow-x-clip text-ellipsis whitespace-nowrap"
										>
											{verb} <RelativeTime ms={ms} now={now} />
										</span>
										{artifact.audience === "owner" && <span className="sr-only">Private</span>}
									</div>
								</div>
							</div>
						</div>
					</div>
					<div
						data-card-actions=""
						className="absolute end-4 top-4 z-10 flex items-center gap-1 transition-opacity has-[[data-popup-open]]:opacity-100"
					>
						<span data-card-more="" className={CARD_ACTION_SEAT_CLASS}>
							<span
								aria-hidden="true"
								className="absolute inset-0 rounded-[inherit] bg-surface-1 opacity-75"
							/>
							<ArtifactMoreMenu
								artifact={artifact}
								pinned={pinned}
								className={CARD_ACTION_BUTTON_CLASS}
							/>
						</span>
						<span data-pin-at-rest={pinned ? "shown" : "hidden"} className={CARD_ACTION_SEAT_CLASS}>
							<span
								aria-hidden="true"
								className="absolute inset-0 rounded-[inherit] bg-surface-1 opacity-75"
							/>
							<ArtifactPinButton
								artifact={artifact}
								pinned={pinned}
								className={CARD_ACTION_BUTTON_CLASS}
							/>
						</span>
					</div>
				</div>
			</ArtifactContextMenu>
		</li>
	);
}
