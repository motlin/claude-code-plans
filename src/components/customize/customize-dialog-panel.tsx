import {useCallback, useMemo, useState} from "react";
import {customizePluginFileQueryOptions, customizeSkillFileQueryOptions} from "../../lib/api/customize";
import {type CustomizeLocation, type CustomizeSection, customizeHash} from "../../lib/settings-hash";
import {ContentsViewer} from "./contents-viewer";
import {CustomizeHeader} from "./customize-header";
import {CustomizeNavContext, type CustomizeNavigator, type CustomizeTarget} from "./customize-navigation";
import {ConnectorDetailFrame, PluginDetailFrame, SkillDetailFrame} from "./detail-frames";
import {PluginConnectors, PluginFiles, PluginHooks, PluginOverview, PluginSkills} from "./plugin-detail";
import {ConnectorsSection, PluginsSection, SkillsSection} from "./section-views";
import {CUSTOMIZE_SECTIONS, type CustomizeSearch, dropEmpty} from "./sections";
import {SkillOverview} from "./skill-detail";
import {CustomizeUnifiedSearch} from "./customize-unified-search";
import type {UnifiedHit} from "./unified-search";
import type {UnifiedSectionId} from "./unified-search-results";
import {assertNever} from "../../lib/assert-never";

/** The hash (without `#`) a Customize target opens inside the Settings dialog. */
function targetHash(target: CustomizeTarget, withFile = true): string {
	switch (target.kind) {
		case "list":
			return customizeHash({
				section: target.section,
				view: target.search?.view === "discover" ? "discover" : "yours",
			});
		case "skill":
			return customizeHash({
				section: "skills",
				id: target.id,
				tab: target.tab === "contents" ? "contents" : null,
			});
		case "plugin":
			return customizeHash({
				section: "plugins",
				id: target.id,
				tab: target.tab === "overview" ? null : target.tab,
				file: withFile ? (target.file ?? null) : null,
			});
		case "connector":
			return customizeHash({section: "connectors", id: target.slug});
		default:
			return assertNever(target);
	}
}

const NO_SECTIONS: UnifiedSectionId[] = [];

/** The detail a unified search hit opened, and the search to restore from its "Search" back link. */
interface SearchReturn {
	section: CustomizeSection;
	id: string;
	listHash: string;
	listSection: CustomizeSection;
	query: string;
	expanded: UnifiedSectionId[];
}

/** The detail `target` opens, as its section and id; null for a list or an external link. */
function openedDetail(target: CustomizeTarget): {section: CustomizeSection; id: string} | null {
	switch (target.kind) {
		case "list":
			return null;
		case "skill":
			return {section: "skills", id: target.id};
		case "plugin":
			return {section: "plugins", id: target.id};
		case "connector":
			return {section: "connectors", id: target.slug};
		default:
			return assertNever(target);
	}
}

interface CustomizeDialogPanelProps {
	location: CustomizeLocation;
	/** Moves the dialog to `hash` (without `#`), replacing the history entry when asked. */
	onNavigate: (hash: string, replace: boolean) => void;
}

/**
 * Skills, Connectors and Plugins inside the Settings dialog, as upstream's
 * `#customize/<section>/yours`. The view and open detail live in the hash;
 * Filter and Sort are kept per section for as long as the panel is open. The
 * query is shared: any non-empty one swaps the section body for upstream's
 * unified results, which are the same in every section and view. Like
 * upstream, moving to another section clears it; the query belongs to the
 * section it was typed in, so a "Search" back link restores it there.
 */
export default function CustomizeDialogPanel({location, onNavigate}: CustomizeDialogPanelProps) {
	const [searches, setSearches] = useState<Partial<Record<CustomizeSection, CustomizeSearch>>>({});
	const [typed, setTyped] = useState<{section: CustomizeSection; query: string}>({
		section: location.section,
		query: "",
	});
	// The section last rendered: arriving in another one drops a query typed elsewhere.
	const [seenSection, setSeenSection] = useState(location.section);
	if (location.section !== seenSection) {
		setSeenSection(location.section);
		if (typed.section !== location.section) setTyped({section: location.section, query: ""});
	}
	const query = typed.section === location.section ? typed.query : "";
	// Show all state belongs to the query it was expanded for, so it survives opening a hit and coming back.
	const [expanded, setExpanded] = useState<{query: string; sections: UnifiedSectionId[]}>({query: "", sections: []});
	const [searchReturn, setSearchReturn] = useState<SearchReturn | null>(null);
	const expandedSections = expanded.query === query ? expanded.sections : NO_SECTIONS;
	const section = CUSTOMIZE_SECTIONS.find((config) => config.id === location.section) ?? CUSTOMIZE_SECTIONS[0];

	const patchSearch = useCallback((id: CustomizeSection, patch: CustomizeSearch) => {
		const {q, ...rest} = patch;
		if ("q" in patch) setTyped({section: id, query: q ?? ""});
		setSearches((previous) => ({...previous, [id]: dropEmpty({...previous[id], ...rest, view: undefined})}));
	}, []);

	const current = customizeHash({...location, file: null});
	const navigator = useMemo(
		(): CustomizeNavigator => ({
			href: (target) => `#${targetHash(target)}`,
			isCurrent: (target) => targetHash(target, false) === current,
			go: (target) => {
				if (target.kind === "list" && target.search !== undefined) patchSearch(target.section, target.search);
				// Moving within the opened detail (its tabs) keeps the way back to the search; anything else drops it.
				const opened = openedDetail(target);
				setSearchReturn((previous) =>
					previous !== null && opened?.section === previous.section && opened.id === previous.id
						? previous
						: null,
				);
				onNavigate(targetHash(target), false);
			},
			searchReturn:
				searchReturn !== null && location.section === searchReturn.section && location.id === searchReturn.id
					? {
							href: `#${searchReturn.listHash}`,
							go: () => {
								setTyped({section: searchReturn.listSection, query: searchReturn.query});
								setExpanded({query: searchReturn.query, sections: searchReturn.expanded});
								setSearchReturn(null);
								onNavigate(searchReturn.listHash, false);
							},
						}
					: null,
		}),
		[current, onNavigate, patchSearch, searchReturn, location.section, location.id],
	);

	const search: CustomizeSearch = {
		...searches[section.id],
		...(section.hasDiscover && location.view === "discover" ? {view: "discover" as const} : {}),
	};
	const openHit = useCallback(
		(hit: UnifiedHit) => {
			if (hit.open === null) return;
			if (hit.open.kind === "external") {
				window.open(hit.open.href, "_blank", "noopener,noreferrer");
				return;
			}
			navigator.go(hit.open);
			const opened = openedDetail(hit.open);
			if (opened !== null) {
				setSearchReturn({
					...opened,
					listHash: customizeHash({section: section.id, view: location.view}),
					listSection: section.id,
					query,
					expanded: expandedSections,
				});
			}
		},
		[navigator, section.id, location.view, query, expandedSections],
	);

	return (
		<CustomizeNavContext.Provider value={navigator}>
			{location.id === null ? (
				// Upstream's pane frame: the header stays put and only the list below it scrolls.
				<div className="flex h-full min-h-0 flex-1 flex-col pt-1">
					<CustomizeHeader
						embedded
						section={section}
						search={query === "" ? search : {...search, q: query}}
						onSearchChange={(patch) => {
							const {view, ...rest} = patch;
							if (Object.keys(rest).length > 0) patchSearch(section.id, rest);
							if ("view" in patch && view !== search.view) {
								onNavigate(
									customizeHash({
										section: section.id,
										view: view === "discover" ? "discover" : "yours",
									}),
									true,
								);
							}
						}}
					/>
					<div aria-hidden="true" className="shrink-0 h-4" />
					<div className="relative -mt-1 flex min-h-0 flex-1 flex-col overflow-y-auto pb-3 pt-1">
						<div className="mx-auto w-full max-w-4xl px-5 flex flex-1 flex-col">
							{query === "" ? (
								<SectionBody location={location} search={search} />
							) : (
								<CustomizeUnifiedSearch
									q={query}
									surface="dialog"
									onOpen={openHit}
									expanded={expandedSections}
									onExpandedChange={(sections) => {
										setExpanded({query, sections});
									}}
								/>
							)}
						</div>
					</div>
				</div>
			) : (
				<div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-2 pb-4">
					<DetailBody location={location} id={location.id} />
				</div>
			)}
		</CustomizeNavContext.Provider>
	);
}

function SectionBody({location, search}: {location: CustomizeLocation; search: CustomizeSearch}) {
	switch (location.section) {
		case "skills":
			return <SkillsSection search={search} />;
		case "connectors":
			return <ConnectorsSection search={search} />;
		case "plugins":
			return <PluginsSection search={search} />;
		default:
			return assertNever(location.section);
	}
}

function DetailBody({location, id}: {location: CustomizeLocation; id: string}) {
	switch (location.section) {
		case "skills":
			return (
				<SkillDetailFrame skillId={id}>
					{(detail) =>
						location.tab === "contents" ? (
							<ContentsViewer
								name={detail.skill.name}
								tree={detail.tree}
								fileQuery={(path) => customizeSkillFileQueryOptions(id, path)}
							/>
						) : (
							<SkillOverview detail={detail} />
						)
					}
				</SkillDetailFrame>
			);
		case "connectors":
			return <ConnectorDetailFrame serverId={id} />;
		case "plugins":
			return (
				<PluginDetailFrame pluginId={id}>
					{(detail) => {
						switch (location.tab) {
							case null:
								return <PluginOverview detail={detail} />;
							case "contents":
								return (
									<ContentsViewer
										key={location.file ?? ""}
										name={`${detail.plugin.name} ${detail.plugin.version}`}
										tree={detail.tree}
										initialFile={location.file ?? undefined}
										fileQuery={(path) => customizePluginFileQueryOptions(id, path)}
									/>
								);
							case "skills":
								return <PluginSkills plugin={detail.plugin} />;
							case "connectors":
								return <PluginConnectors detail={detail} />;
							case "agents":
							case "commands":
								return <PluginFiles plugin={detail.plugin} kind={location.tab} />;
							case "hooks":
								return <PluginHooks hooks={detail.hooks} />;
							default:
								return assertNever(location.tab);
						}
					}}
				</PluginDetailFrame>
			);
		default:
			return assertNever(location.section);
	}
}
