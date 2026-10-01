import {createFileRoute, Link, useNavigate} from "@tanstack/react-router";
import {useSuspenseQuery} from "@tanstack/react-query";
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
import {useToast} from "../components/toast";
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
import {Tooltip} from "../components/ui/tooltip";

export const Route = createFileRoute("/artifacts")({
	component: ArtifactsPage,
	validateSearch: (search: Record<string, unknown>): {search?: string; view?: Exclude<ArtifactView, "all">} => {
		const query = search["search"];
		const view = search["view"];
		return {
			...(typeof query === "string" && query !== "" ? {search: query} : {}),
			...(view === "yours" || view === "shared" ? {view} : {}),
		};
	},
	loader: ({context: {queryClient}}) => queryClient.ensureQueryData(artifactsQueryOptions),
	head: () => ({
		meta: [{title: "Artifacts"}],
	}),
});

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

const VIEW_TAB_CLASS =
	"inline-flex h-6 shrink-0 items-center rounded-md px-2 text-[13px] font-medium whitespace-nowrap text-ink-muted transition-colors hover:text-primary aria-selected:bg-fill-ghost-hover aria-selected:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-100";

function isTypeFilter(value: unknown): value is ArtifactTypeFilter {
	return TYPE_FILTERS.includes(value as ArtifactTypeFilter);
}

function ArtifactsPage() {
	const {data: artifacts} = useSuspenseQuery(artifactsQueryOptions);
	const {search = "", view = "all"} = Route.useSearch();
	const navigate = useNavigate();
	const [layout, setLayout] = useState<ArtifactsLayout>("list");
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
		void navigate({
			to: "/artifacts",
			search: {
				...(next.search === "" ? {} : {search: next.search}),
				...(next.view === "all" ? {} : {view: next.view}),
			},
			replace: true,
		});
	}

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col">
			<header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-4 pb-6">
				<div className="flex min-h-12 min-w-0 items-center md:min-h-16 md:items-end">
					<h1 className="min-w-0 font-voice text-[28px]/[36px] font-medium text-primary">Artifacts</h1>
				</div>
				<div className="ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
					<ToolbarSearch
						label="Search your artifacts"
						placeholder="Search artifacts..."
						search={search}
						onSearch={(next) => updateSearch({search: next, view})}
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
				</div>
				<p role="status" className="sr-only">
					{searching ? `${formatCount(visible.length, "artifact")} matching “${search}”` : ""}
				</p>
			</header>

			<div role="tablist" aria-label="Artifacts" className="flex items-center gap-1 pb-3">
				{VIEW_TABS.map((tab) => (
					<button
						key={tab.view}
						type="button"
						role="tab"
						aria-selected={tab.view === view}
						className={VIEW_TAB_CLASS}
						onClick={() => updateSearch({search, view: tab.view})}
					>
						{tab.label}
					</button>
				))}
			</div>

			<div className="flex flex-col pb-12 pt-1">
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

const TILE_BOX = {menu: "size-5 rounded", row: "size-9 rounded-lg", card: "h-full w-full"} as const;
const TILE_ICON = {menu: "size-3.5", row: "size-5", card: "size-10"} as const;

/**
 * Upstream's type tile: a neutral `</>` tile for HTML pages ("Other"), a blue document tile for Docs, and
 * a shapes tile for the "All types" filter option. 36px in list rows, 20px in the filter menu.
 */
function TypeTile({kind, size = "row"}: {kind: ArtifactKind | "all"; size?: keyof typeof TILE_BOX}) {
	const Icon = kind === "docs" ? FileText : kind === "all" ? Shapes : CodeXml;
	const tone = kind === "docs" ? "bg-blue-500/10 text-blue-600 dark:text-blue-300" : "bg-alpha-1 text-secondary";
	const labelled = kind === "docs" && size !== "menu";
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
			className={`absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-accent-100 ${className}`}
		/>
	);
}

const ROW_ACTION_CLASS =
	"pointer-events-auto flex size-6 shrink-0 items-center justify-center rounded-r6 text-ink-muted opacity-0 transition-opacity hover:bg-fill-ghost-hover hover:text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100 group-hover/cdsrow:opacity-100 data-[popup-open]:opacity-100 data-[popup-open]:bg-fill-ghost-hover pointer-coarse:opacity-100";

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
				onSelect={() => togglePin(artifact, pinned)}
			>
				{pinned ? "Unpin" : "Pin"}
			</MenuItem>
			<MenuItem icon={<LinkIcon aria-hidden="true" />} onSelect={() => void copyLink(artifact)}>
				Copy link
			</MenuItem>
		</>
	);
}

/** The hover Pin button and the "More options" ⋮ menu at the end of an artifact row or card. */
function ArtifactRowActions({artifact, pinned}: {artifact: ArtifactSummary; pinned: boolean}) {
	const pinLabel = pinned ? "Unpin" : "Pin";
	return (
		<span className="flex shrink-0 items-center gap-0.5">
			<Tooltip content={pinLabel}>
				<button
					type="button"
					aria-label={`${pinLabel} ${artifact.title}`}
					aria-pressed={pinned}
					className={ROW_ACTION_CLASS}
					onClick={() => togglePin(artifact, pinned)}
				>
					{pinned ? (
						<PinOff aria-hidden="true" className="size-4" />
					) : (
						<Pin aria-hidden="true" className="size-4" />
					)}
				</button>
			</Tooltip>
			<Menu>
				<MenuTrigger aria-label={`More options for ${artifact.title}`} className={ROW_ACTION_CLASS}>
					<EllipsisVertical aria-hidden="true" className="size-4" />
				</MenuTrigger>
				<MenuContent align="end">
					<ArtifactMenuItems artifact={artifact} pinned={pinned} />
				</MenuContent>
			</Menu>
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
				<li key={artifact.url} data-gallery-card="" className="group group/cdsrow relative h-full">
					<ArtifactContextMenu artifact={artifact} pinned={isPinned(artifact.url)}>
						<PrimaryLink artifact={artifact} className="rounded-card" />
						<div className="pointer-events-none relative flex h-full flex-col overflow-hidden rounded-card border border-border bg-surface-2 group-hover:bg-surface-1">
							<div className="relative h-[160px] select-none overflow-hidden">
								<TypeTile kind={artifact.kind} size="card" />
							</div>
							<div className="mx-px border-t border-alpha-1" />
							<div className="relative flex flex-1 flex-col gap-1.5 p-3">
								<div
									aria-hidden="true"
									className="line-clamp-2 min-w-0 text-left text-body leading-5 font-medium text-primary"
								>
									{artifact.title}
								</div>
								<div className="mt-auto flex flex-wrap items-center gap-1 text-caption text-ink-muted">
									<PrivacyAndDate artifact={artifact} now={now} />
								</div>
								<div className="flex items-center gap-1.5">
									<ArtifactChips artifact={artifact} />
									<span className="ms-auto">
										<ArtifactRowActions artifact={artifact} pinned={isPinned(artifact.url)} />
									</span>
								</div>
							</div>
						</div>
					</ArtifactContextMenu>
				</li>
			))}
		</ul>
	);
}
