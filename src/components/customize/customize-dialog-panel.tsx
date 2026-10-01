import {useState} from "react";
import {customizePluginFileQueryOptions, customizeSkillFileQueryOptions} from "../../lib/api/customize";
import {type CustomizeLocation, type CustomizeSection, customizeHash} from "../../lib/settings-hash";
import {ContentsViewer} from "./contents-viewer";
import {CustomizeHeader, dropEmpty} from "./customize-header";
import {CustomizeNavContext, type CustomizeNavigator, type CustomizeTarget} from "./customize-nav";
import {ConnectorDetailFrame, PluginDetailFrame, SkillDetailFrame} from "./detail-frames";
import {PluginConnectors, PluginFiles, PluginHooks, PluginOverview, PluginSkills} from "./plugin-detail";
import {ConnectorsSection, PluginsSection, SkillsSection} from "./section-views";
import {CUSTOMIZE_SECTIONS, type CustomizeSearch} from "./sections";
import {SkillOverview} from "./skill-detail";

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
 * search, Filter and Sort are kept per section for as long as the panel is open.
 */
export default function CustomizeDialogPanel({location, onNavigate}: CustomizeDialogPanelProps) {
	const [searches, setSearches] = useState<Partial<Record<CustomizeSection, CustomizeSearch>>>({});
	const section = CUSTOMIZE_SECTIONS.find((config) => config.id === location.section) ?? CUSTOMIZE_SECTIONS[0]!;

	const patchSearch = (id: CustomizeSection, patch: CustomizeSearch) =>
		setSearches((previous) => ({...previous, [id]: dropEmpty({...previous[id], ...patch, view: undefined})}));

	const current = customizeHash({...location, file: null});
	const navigator: CustomizeNavigator = {
		href: (target) => `#${targetHash(target)}`,
		isCurrent: (target) => targetHash(target, false) === current,
		go: (target) => {
			if (target.kind === "list" && target.search !== undefined) patchSearch(target.section, target.search);
			onNavigate(targetHash(target), false);
		},
	};

	const search: CustomizeSearch = {
		...searches[section.id],
		...(section.hasDiscover && location.view === "discover" ? {view: "discover" as const} : {}),
	};

	return (
		<CustomizeNavContext.Provider value={navigator}>
			{location.id === null ? (
				<div className="flex flex-col gap-6">
					<CustomizeHeader
						embedded
						section={section}
						search={search}
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
					<SectionBody location={location} search={search} />
				</div>
			) : (
				<DetailBody location={location} id={location.id} />
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
						}
					}}
				</PluginDetailFrame>
			);
	}
}
