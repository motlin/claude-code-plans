import {useQuery} from "@tanstack/react-query";
import {Check, Plus, Puzzle, Scroll} from "lucide-react";
import {useState} from "react";
import {customizeDiscoverQueryOptions, type DiscoverPlugin} from "../../lib/api/customize";
import {writeClipboardText} from "../../lib/clipboard";
import {useToast} from "../toast";
import {Tooltip} from "../ui/tooltip";
import {CustomizeNotice} from "./customize-empty";
import {CustomizeList} from "./customize-list";
import {
	categoryCounts,
	discoverForSection,
	formatExactInstalls,
	formatInstallCount,
	groupDiscoverSearch,
	isCatalogStale,
	mostInstalled,
	pluginsInCategory,
	recentlyUpdated,
} from "./discover-view";
import {IconTile} from "./icon-tile";
import {SectionHeader} from "./section-header";
import {pluginInstallCommand} from "./plugin-view";

const CARD_LIMIT = 8;
const CATEGORY_PREVIEW = 8;

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
	yours: readonly DiscoverYoursItem[];
}

function categoryLabel(category: string): string {
	return category.charAt(0).toUpperCase() + category.slice(1);
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

function Categories({plugins, onSelect}: {plugins: readonly DiscoverPlugin[]; onSelect: (category: string) => void}) {
	const [showAll, setShowAll] = useState(false);
	const counts = categoryCounts(plugins);
	if (counts.length === 0) return null;
	const visible = showAll ? counts : counts.slice(0, CATEGORY_PREVIEW);
	return (
		<section aria-labelledby="customize-discover-categories" className="flex flex-col gap-3">
			<div className="flex items-center gap-1.5">
				<h3 id="customize-discover-categories" className="m-0 text-[15px]/[20px] font-[580] text-primary">
					Categories
				</h3>
				{counts.length > CATEGORY_PREVIEW && (
					<>
						<span aria-hidden="true" className="text-t6">
							·
						</span>
						<button
							type="button"
							aria-expanded={showAll}
							onClick={() => setShowAll(!showAll)}
							className="text-body text-secondary hover:text-primary"
						>
							{showAll ? "Show fewer" : `Show all ${counts.length}`}
						</button>
					</>
				)}
			</div>
			<ul className="m-0 flex list-none flex-wrap gap-2 p-0">
				{visible.map(({category, count}) => (
					<li key={category}>
						<button
							type="button"
							onClick={() => onSelect(category)}
							className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface-0 px-3 text-footnote text-primary hover:bg-fill-ghost-hover"
						>
							{categoryLabel(category)}
							<span className="text-t6 tabular-nums">{count}</span>
						</button>
					</li>
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
export function CustomizeDiscover({section, q, yours}: CustomizeDiscoverProps) {
	const {data, isPending, isError} = useQuery(customizeDiscoverQueryOptions);
	const [category, setCategory] = useState<string | null>(null);
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

	return (
		<div className="flex flex-col gap-8">
			{data.fetchedAt !== null && isCatalogStale(data.fetchedAt, Date.now()) && (
				<StaleBanner fetchedAt={data.fetchedAt} />
			)}
			{category === null ? (
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
					<Categories plugins={plugins} onSelect={setCategory} />
				</>
			) : (
				<div className="flex flex-col gap-3">
					<button
						type="button"
						onClick={() => setCategory(null)}
						className="self-start text-body text-secondary hover:text-primary"
					>
						← All categories
					</button>
					<SectionHeader
						id="customize-discover-category"
						title={categoryLabel(category)}
						count={pluginsInCategory(plugins, category).length}
					/>
					<ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
						{pluginsInCategory(plugins, category).map((plugin) => (
							<DiscoverCard key={plugin.id} plugin={plugin} icon={icon} />
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
