import {createFileRoute, Link, useNavigate} from "@tanstack/react-router";
import {useSuspenseQuery} from "@tanstack/react-query";
import {Tabs} from "@base-ui/react/tabs";
import {
	CodeXml,
	EllipsisVertical,
	FileText,
	LayoutGrid,
	Link as LinkIcon,
	List,
	ListFilter,
	Lock,
	Pin,
	PinOff,
	Shapes,
} from "lucide-react";
import {type ReactNode, useEffect, useId, useMemo, useState} from "react";
import {artifactsQueryOptions, type ArtifactSummary} from "../lib/api/artifacts";
import {
	artifactInView,
	artifactTimestamp,
	filterArtifacts,
	formatArtifactDate,
	groupArtifactsByDate,
	readArtifactsLayout,
	writeArtifactsLayout,
	type ArtifactKind,
	type ArtifactsLayout,
	type ArtifactTypeFilter,
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
	MenuContent,
	MenuItem,
	MenuRadioGroup,
	MenuRadioItem,
	MenuTrigger,
} from "../components/ui/menu";
import {CodePageHeader} from "../components/code-page-header";
import {Tooltip} from "../components/ui/tooltip";

export const Route = createFileRoute("/artifacts")({
	component: ArtifactsPage,
	staticData: {pageGutter: "none"},
	validateSearch: (search: Record<string, unknown>): {search?: string; tab?: ArtifactTabParam} => {
		const query = search["search"];
		const tab = tabParamFromSearch(search);
		return {
			...(typeof query === "string" && query !== "" ? {search: query} : {}),
			...(tab === undefined ? {} : {tab}),
		};
	},
	loader: async ({context: {queryClient}}) => queryClient.query({...artifactsQueryOptions, staleTime: "static"}),
	head: () => ({
		meta: [{title: "Artifacts"}],
	}),
});

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

/** Upstream's type vocabulary: anything that is not a Doc (or a Slides/Design type we never see) is "Other". */
const TYPE_FILTER_LABELS: Record<ArtifactTypeFilter, string> = {
	all: "All types",
	docs: "Docs",
	html: "Other",
};

const TYPE_FILTERS: readonly ArtifactTypeFilter[] = ["all", "docs", "html"];

const VIEW_TABS: ReadonlyArray<{view: ArtifactView; label: string}> = [
	{view: "all", label: "All"},
	{view: "yours", label: "Yours"},
	{view: "shared", label: "Shared with you"},
];

/** Upstream's cds Page content box (`mx-auto w-full px-md md:px-8 max-w-5xl`), shared by the sticky header and the list. */
const ARTIFACTS_BOX_CLASS = "mx-auto w-full max-w-5xl px-2 md:px-8";

const VIEW_TAB_CLASS =
	"inline-flex h-6 shrink-0 items-center rounded-md px-2 text-[13px] font-medium whitespace-nowrap text-ink-muted transition-colors hover:text-primary aria-selected:bg-fill-ghost-hover aria-selected:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

function isTypeFilter(value: unknown): value is ArtifactTypeFilter {
	return TYPE_FILTERS.some((filter) => filter === value);
}

function ArtifactsPage() {
	const {data: artifacts} = useSuspenseQuery(artifactsQueryOptions);
	const {search = "", tab: tabParam} = Route.useSearch();
	const view = viewFromTabParam(tabParam);
	const navigate = useNavigate();
	const [layout, setLayout] = useState<ArtifactsLayout>("grid");
	const [searchOpen, setSearchOpen] = useState(false);
	const [type, setType] = useState<ArtifactTypeFilter>("all");
	const now = useMemo(() => new Date(), []);

	useEffect(() => {
		setLayout(readArtifactsLayout());
	}, []);

	const inView = useMemo(
		() => artifacts.filter((artifact) => artifactInView(artifact.audience, view)),
		[artifacts, view],
	);
	const visible = useMemo(() => filterArtifacts(inView, {search, type}), [inView, search, type]);
	const {isPinned} = useArtifactPins();
	const pinned = visible.filter((artifact) => isPinned(artifact.url));
	const unpinned = visible.filter((artifact) => !isPinned(artifact.url));
	const searching = search.trim() !== "";
	const layoutLabel = layout === "grid" ? "List view" : "Grid view";

	function toggleLayout() {
		const next: ArtifactsLayout = layout === "grid" ? "list" : "grid";
		setLayout(next);
		writeArtifactsLayout(next);
	}

	function updateSearch(next: {search: string; view: ArtifactView}) {
		const tab = tabParamFromView(next.view);
		void navigate({
			to: "/artifacts",
			search: {
				...(next.search === "" ? {} : {search: next.search}),
				...(tab === undefined ? {} : {tab}),
			},
			replace: true,
		});
	}

	return (
		<div className="flex w-full flex-col">
			<CodePageHeader
				title="Artifacts"
				sticky={{box: ARTIFACTS_BOX_CLASS}}
				searchOpen={searchOpen}
				tabs={
					<Tabs.Root
						value={view}
						onValueChange={(next: unknown) => {
							if (isArtifactView(next)) updateSearch({search, view: next});
						}}
					>
						<Tabs.List activateOnFocus={false} aria-label="Artifacts" className="flex items-center gap-1">
							{VIEW_TABS.map((tab) => (
								<Tabs.Tab key={tab.view} value={tab.view} className={VIEW_TAB_CLASS}>
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
								updateSearch({search: next, view});
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
						<TypeFilterMenu artifacts={inView} type={type} onChange={setType} />
					</>
				}
			>
				<p role="status" className="sr-only">
					{searching ? `${formatCount(visible.length, "artifact")} matching “${search}”` : ""}
				</p>
			</CodePageHeader>

			<div className={`${ARTIFACTS_BOX_CLASS} flex flex-col pb-12 pt-1`}>
				{artifacts.length === 0 ? (
					<div className="flex flex-col items-start gap-3 pb-12 text-body">
						<h3 className="max-w-xs font-medium text-secondary">No artifacts yet</h3>
						<p className="max-w-xs text-footnote text-secondary">
							Artifacts that Claude publishes in your sessions appear here.
						</p>
					</div>
				) : visible.length === 0 ? (
					<div role="status" className="mt-10 text-center text-body text-ink-muted">
						{searching
							? `No artifacts matching “${search}”`
							: inView.length === 0
								? view === "yours"
									? "No artifacts of yours"
									: "No artifacts shared with you"
								: "No artifacts of this type"}
					</div>
				) : layout === "grid" ? (
					<ArtifactGrid artifacts={[...pinned, ...unpinned]} now={now} isPinned={isPinned} />
				) : (
					<ArtifactList pinned={pinned} artifacts={unpinned} now={now} />
				)}
			</div>
		</div>
	);
}

function TypeFilterMenu({
	artifacts,
	type,
	onChange,
}: {
	artifacts: readonly ArtifactSummary[];
	type: ArtifactTypeFilter;
	onChange: (next: ArtifactTypeFilter) => void;
}) {
	const counts: Record<ArtifactTypeFilter, number> = {
		all: artifacts.length,
		html: artifacts.filter((artifact) => artifact.kind === "html").length,
		docs: artifacts.filter((artifact) => artifact.kind === "docs").length,
	};
	const label = `Filter by type: ${TYPE_FILTER_LABELS[type]}`;
	return (
		<Menu>
			<Tooltip content={label}>
				<MenuTrigger className={TOOLBAR_ICON_BUTTON} aria-label={label} aria-pressed={type !== "all"}>
					<ListFilter aria-hidden="true" />
				</MenuTrigger>
			</Tooltip>
			<MenuContent align="end">
				<MenuRadioGroup
					value={type}
					onValueChange={(next: unknown) => {
						if (isTypeFilter(next)) onChange(next);
					}}
				>
					{TYPE_FILTERS.map((option) => (
						<MenuRadioItem key={option} value={option}>
							<span className="flex w-full items-center gap-2">
								<TypeTile kind={option} size="menu" />
								<span>{TYPE_FILTER_LABELS[option]}</span>
								{option !== "all" && (
									<>
										{" "}
										<span className="ms-auto ps-4 text-footnote tabular-nums text-ink-muted">
											{counts[option]}
										</span>
									</>
								)}
							</span>
						</MenuRadioItem>
					))}
				</MenuRadioGroup>
			</MenuContent>
		</Menu>
	);
}

const TILE_BOX = {
	menu: "size-5 rounded",
	row: "size-9 rounded-lg",
	card: "h-full w-full",
	badge: "size-6 rounded-r5",
} as const;
const TILE_ICON = {menu: "size-3.5", row: "size-5", card: "size-10", badge: "size-4"} as const;

/**
 * Upstream's type tile: a neutral `</>` tile for HTML pages ("Other"), a blue document tile for Docs, and
 * a shapes tile for the "All types" filter option. 36px in list rows, 20px in the filter menu.
 */
function TypeTile({kind, size = "row"}: {kind: ArtifactKind | "all"; size?: keyof typeof TILE_BOX}) {
	const Icon = kind === "docs" ? FileText : kind === "all" ? Shapes : CodeXml;
	// Upstream's straddling card tile is neutral for every type.
	const tone =
		kind === "docs" && size !== "badge"
			? "bg-blue-500/10 text-blue-600 dark:text-blue-300"
			: "bg-alpha-1 text-secondary";
	const labelled = kind === "docs" && size !== "menu" && size !== "badge";
	return (
		<div
			{...(labelled ? {role: "img", "aria-label": "Docs"} : {"aria-hidden": true})}
			data-type-tile={kind}
			className={`flex shrink-0 items-center justify-center overflow-hidden ${TILE_BOX[size]} ${tone}`}
		>
			<Icon aria-hidden="true" className={TILE_ICON[size]} />
		</div>
	);
}

function PrivacyAndDate({
	artifact,
	now,
	lockClass = "size-3.5",
}: {
	artifact: ArtifactSummary;
	now: Date;
	lockClass?: string;
}) {
	const ms = artifactTimestamp(artifact);
	return (
		<>
			{artifact.audience === "owner" && (
				<>
					<Tooltip content="Private" className="pointer-events-auto shrink-0">
						<span role="img" aria-label="Private" className="flex shrink-0 items-center">
							<Lock aria-hidden="true" className={lockClass} />
						</span>
					</Tooltip>
					<span aria-hidden="true" className="inline-block size-[3px] shrink-0 rounded-full bg-ink-muted" />
				</>
			)}
			<span data-artifact-meta="">
				{artifact.lastPublishedAt === null ? "Viewed" : "Edited"}{" "}
				<time dateTime={new Date(ms).toISOString()}>{formatArtifactDate(ms, now)}</time>
			</span>
		</>
	);
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
	"pointer-events-auto flex size-6 shrink-0 items-center justify-center rounded-r6 text-ink-muted opacity-0 transition-opacity hover:bg-fill-ghost-hover hover:text-primary focus-visible:opacity-100 hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus group-hover/cdsrow:opacity-100 data-[popup-open]:opacity-100 data-[popup-open]:bg-fill-ghost-hover pointer-coarse:opacity-100";

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

/** Upstream's row menu within local limits: Rename, Duplicate and Delete are cloud mutations. */
function ArtifactMenuItems({artifact, pinned}: {artifact: ArtifactSummary; pinned: boolean}) {
	const copyLink = useCopyArtifactLink();
	return (
		<>
			<MenuItem
				icon={pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
				onSelect={() => {
					togglePin(artifact, pinned);
				}}
			>
				{pinned ? "Unpin" : "Pin"}
			</MenuItem>
			<MenuItem icon={<LinkIcon aria-hidden="true" />} onSelect={() => void copyLink(artifact)}>
				Copy link
			</MenuItem>
		</>
	);
}

function ArtifactPinButton({
	artifact,
	pinned,
	className = "",
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
				aria-label={`${pinLabel} ${artifact.title}`}
				aria-pressed={pinned}
				className={`${ROW_ACTION_CLASS} ${className}`}
				onClick={() => {
					togglePin(artifact, pinned);
				}}
			>
				{pinned ? (
					<PinOff aria-hidden="true" className="size-4" />
				) : (
					<Pin aria-hidden="true" className="size-4" />
				)}
			</button>
		</Tooltip>
	);
}

function ArtifactMoreMenu({
	artifact,
	pinned,
	className = "",
}: {
	artifact: ArtifactSummary;
	pinned: boolean;
	className?: string;
}) {
	return (
		<Menu>
			<MenuTrigger
				aria-label={`More options for ${artifact.title}`}
				className={`${ROW_ACTION_CLASS} ${className}`}
			>
				<EllipsisVertical aria-hidden="true" className="size-4" />
			</MenuTrigger>
			<MenuContent align="end">
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

function ArtifactList({pinned, artifacts, now}: {pinned: ArtifactSummary[]; artifacts: ArtifactSummary[]; now: Date}) {
	const idPrefix = useId();
	const groups = [
		...(pinned.length > 0 ? [{label: "Pinned", items: pinned, pinned: true}] : []),
		...groupArtifactsByDate(artifacts, now).map((group) => ({...group, pinned: false})),
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

function ArtifactGrid({
	artifacts,
	now,
	isPinned,
}: {
	artifacts: ArtifactSummary[];
	now: Date;
	isPinned: (url: string) => boolean;
}) {
	return (
		<ul role="list" className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
			{artifacts.map((artifact) => (
				<ArtifactCard key={artifact.url} artifact={artifact} now={now} pinned={isPinned(artifact.url)} />
			))}
		</ul>
	);
}

function ArtifactCard({artifact, now, pinned}: {artifact: ArtifactSummary; now: Date; pinned: boolean}) {
	return (
		<li data-gallery-card="" className="group group/cdsrow relative h-full">
			<ArtifactContextMenu artifact={artifact} pinned={pinned}>
				<PrimaryLink artifact={artifact} className="rounded-r7" />
				<div
					data-card-frame=""
					className="pointer-events-none relative flex h-full flex-col overflow-hidden rounded-r7 bg-surface-2 after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border group-hover:bg-surface-1"
				>
					<div data-card-preview="" className="relative h-[160px] shrink-0 select-none overflow-hidden">
						<TypeTile kind={artifact.kind} size="card" />
					</div>
					<div className="mx-px border-t border-alpha-1" />
					<div data-card-body="" className="relative flex flex-1 flex-col gap-1.5 p-3.5">
						{/* Upstream's 28px type tile straddles the divider, 12px in from the card's edge */}
						<div
							data-card-badge=""
							className="absolute start-3 top-0 size-7 -translate-y-2/3 rounded-r6 bg-surface-2 p-0.5"
						>
							<TypeTile kind={artifact.kind} size="badge" />
						</div>
						<div
							aria-hidden="true"
							data-card-title=""
							className="line-clamp-2 min-w-0 text-left text-[13px]/[20px] font-medium text-primary"
						>
							{artifact.title}
						</div>
						<div
							data-card-meta=""
							className="mt-auto flex items-center gap-1 text-[11px]/[17px] text-ink-muted"
						>
							<PrivacyAndDate artifact={artifact} now={now} lockClass="size-4" />
							<ArtifactPinButton artifact={artifact} pinned={pinned} className="-my-1 p-1" />
						</div>
					</div>
				</div>
				<div data-card-more="" className="absolute end-3 top-3 z-10">
					<ArtifactMoreMenu artifact={artifact} pinned={pinned} className="bg-page" />
				</div>
			</ArtifactContextMenu>
		</li>
	);
}
