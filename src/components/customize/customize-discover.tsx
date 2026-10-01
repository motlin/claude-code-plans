import {useQuery} from "@tanstack/react-query";
import {Check, Plus, Puzzle, Scroll} from "lucide-react";
import {customizeDiscoverQueryOptions, type DiscoverPlugin} from "../../lib/api/customize";
import {writeClipboardText} from "../../lib/clipboard";
import {useToast} from "../toast";
import {Tooltip} from "../ui/tooltip";
import {CustomizeNotice} from "./customize-empty";
import {CustomizeList} from "./customize-list";
import {
	ALL_CATEGORIES,
	categoryLabel,
	DISCOVER_SORT_OPTIONS,
	discoverForSection,
	filterDiscover,
	formatExactInstalls,
	formatInstallCount,
	groupDiscoverSearch,
	isCatalogStale,
	mostInstalled,
	recentlyUpdated,
	sortDiscover,
} from "./discover-view";
import {IconTile} from "./icon-tile";
import {SectionHeader} from "./section-header";
import {resolveOption} from "./sections";
import {pluginInstallCommand} from "./plugin-view";

const CARD_LIMIT = 8;

/** A row under "Yours" in search results. */
interface DiscoverYoursItem {
	key: string;
	title: string;
	source: string;
	subtitle: string;
	onView?: () => void;
}

interface CustomizeDiscoverProps {
	section: "skills" | "plugins";
	q: string | undefined;
	/** `?category=`: the Filter menu's choice; absent or "all" means every category. */
	category: string | undefined;
	/** `?order=`: the Sort menu's choice; absent means Most installed. */
	order: string | undefined;
	yours: readonly DiscoverYoursItem[];
}

function useCopyInstall() {
	const toast = useToast();
	return async (plugin: DiscoverPlugin) => {
		const command = pluginInstallCommand(plugin.id);
		const copied = await writeClipboardText(command);
		toast(
			copied ? {kind: "success", message: `Command copied: ${command}`} : {kind: "error", message: "Copy failed"},
		);
	};
}

/** "+" copies the install command; plugins already installed show "Installed ✓" instead. */
function AddButton({plugin}: {plugin: DiscoverPlugin}) {
	const copyInstall = useCopyInstall();
	if (plugin.installed) {
		return (
			<span className="inline-flex shrink-0 items-center gap-1 text-footnote text-t6">
				Installed
				<Check aria-hidden="true" className="size-3.5" />
			</span>
		);
	}
	return (
		<Tooltip content="Copy install command">
			<button
				type="button"
				aria-label={`Copy install command for ${plugin.title}`}
				onClick={() => void copyInstall(plugin)}
				className="inline-flex size-7 shrink-0 items-center justify-center rounded-r6 border border-border bg-surface-0 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary"
			>
				<Plus aria-hidden="true" className="size-4" />
			</button>
		</Tooltip>
	);
}

/** "8.3M installs" with the exact count in a tooltip. */
function Installs({count}: {count: number}) {
	return (
		<Tooltip content={formatExactInstalls(count)}>
			<span tabIndex={0} className="outline-none">
				{formatInstallCount(count)} installs
			</span>
		</Tooltip>
	);
}

function CardMeta({plugin}: {plugin: DiscoverPlugin}) {
	const by = plugin.author ?? plugin.marketplace;
	return (
		<span className="flex min-w-0 items-center gap-1.5 truncate text-footnote text-t6">
			<span className="truncate">by {by}</span>
			{plugin.installs !== null && (
				<>
					<span aria-hidden="true">·</span>
					<Installs count={plugin.installs} />
				</>
			)}
		</span>
	);
}

function DiscoverCard({plugin, icon}: {plugin: DiscoverPlugin; icon: typeof Puzzle}) {
	return (
		<li
			data-testid="customize-discover-card"
			className="flex min-w-0 items-start gap-3 rounded-card border border-border bg-surface-0 p-4"
		>
			<IconTile icon={icon} />
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<span className="truncate text-body font-medium text-primary">{plugin.title}</span>
				<p className="m-0 line-clamp-2 text-footnote text-secondary">{plugin.description}</p>
				<CardMeta plugin={plugin} />
			</div>
			<AddButton plugin={plugin} />
		</li>
	);
}

function CardSection({
	id,
	title,
	plugins,
	icon,
}: {
	id: string;
	title: string;
	plugins: readonly DiscoverPlugin[];
	icon: typeof Puzzle;
}) {
	if (plugins.length === 0) return null;
	return (
		<section aria-labelledby={id} className="flex flex-col gap-3">
			<h3 id={id} className="m-0 text-[15px]/[20px] font-[580] text-primary">
				{title}
			</h3>
			<ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
				{plugins.map((plugin) => (
					<DiscoverCard key={plugin.id} plugin={plugin} icon={icon} />
				))}
			</ul>
		</section>
	);
}

function StaleBanner({fetchedAt}: {fetchedAt: string}) {
	const date = new Date(fetchedAt).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
	return (
		<div
			role="status"
			data-testid="customize-discover-stale"
			className="rounded-card border border-border bg-fill-ghost-hover px-4 py-3 text-body text-secondary"
		>
			The plugin catalog was last fetched {date}, so install counts and listings may be out of date. Claude Code
			refreshes it when it runs.
		</div>
	);
}

/**
 * Read-only local Discover for Skills and Plugins, built from the CLI's
 * plugin-catalog-cache.json plus every marketplace.json. Nothing installs from
 * here: "+" copies `claude plugin install <name>@<marketplace>`.
 */
export function CustomizeDiscover({section, q, category, order, yours}: CustomizeDiscoverProps) {
	const {data, isPending, isError} = useQuery(customizeDiscoverQueryOptions);
	const icon = section === "skills" ? Scroll : Puzzle;
	const noun = section === "skills" ? "skills" : "plugins";

	if (isError) {
		return <CustomizeNotice title="Discover" body="The plugin catalog could not be read." />;
	}
	if (isPending) return <p className="text-body text-t6">Loading catalog…</p>;

	const plugins = discoverForSection(data.plugins, section);
	const term = q?.trim() ?? "";

	if (term !== "") {
		const results = groupDiscoverSearch(yours, (item) => [item.title, item.subtitle], plugins, term);
		return (
			<CustomizeList
				icon={icon}
				noun={noun}
				searching
				groups={[
					{key: "yours", title: "Yours", items: results.yours},
					{
						key: "more",
						title: "More you can add",
						items: results.more.map((plugin) => ({
							key: plugin.id,
							title: plugin.title,
							source: categoryLabel(plugin.category ?? plugin.marketplace),
							subtitle: plugin.description,
							...(plugin.installs === null ? {} : {meta: <Installs count={plugin.installs} />}),
							actions: <AddButton plugin={plugin} />,
						})),
					},
				]}
				empty={null}
			/>
		);
	}

	if (plugins.length === 0) {
		return (
			<CustomizeNotice
				title="Nothing to discover yet"
				body="Claude Code writes the plugin catalog to ~/.claude/plugins/plugin-catalog-cache.json and marketplaces to ~/.claude/plugins/marketplaces."
			/>
		);
	}

	// Any Filter or Sort choice replaces the sectioned landing with one grid.
	const chosenCategory = category === undefined || category === ALL_CATEGORIES ? undefined : category;
	const sort = resolveOption(DISCOVER_SORT_OPTIONS, order).value;
	const narrowed = chosenCategory !== undefined || sort !== DISCOVER_SORT_OPTIONS[0]!.value;
	const filtered = {
		categoryTitle: chosenCategory === undefined ? "All categories" : categoryLabel(chosenCategory),
		plugins: sortDiscover(filterDiscover(plugins, chosenCategory), sort),
	};

	return (
		<div className="flex flex-col gap-8">
			{data.fetchedAt !== null && isCatalogStale(data.fetchedAt, Date.now()) && (
				<StaleBanner fetchedAt={data.fetchedAt} />
			)}
			{narrowed ? (
				<div className="flex flex-col gap-3">
					<SectionHeader
						id="customize-discover-filtered"
						title={filtered.categoryTitle}
						count={filtered.plugins.length}
					/>
					<ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
						{filtered.plugins.map((plugin) => (
							<DiscoverCard key={plugin.id} plugin={plugin} icon={icon} />
						))}
					</ul>
				</div>
			) : (
				<>
					<CardSection
						id="customize-discover-most-installed"
						title={section === "skills" ? "Most installed skills" : "Most installed"}
						plugins={mostInstalled(plugins, CARD_LIMIT)}
						icon={icon}
					/>
					<CardSection
						id="customize-discover-recent"
						title="Recently updated"
						plugins={recentlyUpdated(plugins, CARD_LIMIT)}
						icon={icon}
					/>
				</>
			)}
		</div>
	);
}
