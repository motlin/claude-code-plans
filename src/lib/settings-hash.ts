import {z} from "zod";

/** Settings dialog tabs, in nav order. Upstream deep-links them as `#settings/<tab>[/<row>]`. */
export const SettingsTabSchema = z.enum([
	"general",
	"usage",
	"claude-code",
	"transcript",
	"sessions",
	"application",
	"ai-features",
	"claude-config",
	"setup",
]);

export type SettingsTab = z.infer<typeof SettingsTabSchema>;

export interface SettingsLocation {
	tab: SettingsTab;
	row: string | null;
}

const SETTINGS_HASH = /^#?settings\/([^/]+)(?:\/([a-z0-9-]*))?$/;

/** Parse a location hash (with or without the leading `#`) into a Settings tab and row. */
export function parseSettingsHash(hash: string): SettingsLocation | null {
	const match = SETTINGS_HASH.exec(hash);
	if (match === null) return null;
	const tab = SettingsTabSchema.safeParse(match[1]);
	if (!tab.success) return null;
	const row = match[2];
	return {tab: tab.data, row: row === undefined || row === "" ? null : row};
}

/** The hash (without `#`) that opens Settings on `tab`, optionally at `row`. */
export function settingsHash(tab: SettingsTab, row?: string): string {
	return row === undefined ? `settings/${tab}` : `settings/${tab}/${row}`;
}

/** Customize sections the Settings dialog opens as `#customize/<section>/…`, as upstream's Skills · Connectors · Plugins. */
export const CustomizeSectionSchema = z.enum(["skills", "connectors", "plugins"]);
export type CustomizeSection = z.infer<typeof CustomizeSectionSchema>;

export const CustomizeViewSchema = z.enum(["yours", "discover"]);
export type CustomizeView = z.infer<typeof CustomizeViewSchema>;

/** Detail tabs after the default Overview: skills have Contents; plugins have every one. */
export const CustomizeDetailTabSchema = z.enum(["contents", "skills", "connectors", "agents", "commands", "hooks"]);
export type CustomizeDetailTab = z.infer<typeof CustomizeDetailTabSchema>;

export interface CustomizeLocation {
	section: CustomizeSection;
	view: CustomizeView;
	/** The decoded skill id, plugin id or connector slug of an open detail, or null on the list. */
	id: string | null;
	tab: CustomizeDetailTab | null;
	/** A plugin Contents file to select, as `agents/<file>.md`. */
	file: string | null;
}

const CUSTOMIZE_HASH = /^#?customize\/([a-z]+)(?:\/([a-z]+)(?:\/id\/([^/]+)(?:\/([a-z]+)(?:\/([^/]+))?)?)?)?$/;

function decodeSegment(segment: string): string | null {
	try {
		return decodeURIComponent(segment);
	} catch {
		return null;
	}
}

/** Parse `#customize/<section>[/(yours|discover)][/id/<id>[/<tab>[/<file>]]]`, with `<id>` and `<file>` URI-encoded. */
export function parseCustomizeHash(hash: string): CustomizeLocation | null {
	const match = CUSTOMIZE_HASH.exec(hash);
	if (match === null) return null;
	const [, rawSection, rawView, rawId, rawTab, rawFile] = match;
	const section = CustomizeSectionSchema.safeParse(rawSection);
	if (!section.success) return null;
	const view = CustomizeViewSchema.safeParse(rawView ?? "yours");
	if (!view.success) return null;
	if (view.data === "discover" && section.data === "connectors") return null;
	const id = rawId === undefined ? null : decodeSegment(rawId);
	if (rawId !== undefined && (id === null || id === "")) return null;
	const tab = rawTab === undefined ? null : CustomizeDetailTabSchema.safeParse(rawTab);
	if (tab !== null && !tab.success) return null;
	const tabValue = tab?.data ?? null;
	if (tabValue !== null && !detailTabAllowed(section.data, tabValue)) return null;
	const file = rawFile === undefined ? null : decodeSegment(rawFile);
	if (rawFile !== undefined && (file === null || section.data !== "plugins" || tabValue !== "contents")) return null;
	return {section: section.data, view: view.data, id, tab: tabValue, file};
}

function detailTabAllowed(section: CustomizeSection, tab: CustomizeDetailTab): boolean {
	if (section === "plugins") return true;
	return section === "skills" && tab === "contents";
}

/** The hash (without `#`) for a Customize location; omitted fields default to the Yours list. */
export function customizeHash({
	section,
	view = "yours",
	id = null,
	tab = null,
	file = null,
}: {section: CustomizeSection} & Partial<Omit<CustomizeLocation, "section">>): string {
	let hash = `customize/${section}/${view}`;
	if (id === null) return hash;
	hash += `/id/${encodeURIComponent(id)}`;
	if (tab !== null) hash += `/${tab}`;
	if (file !== null) hash += `/${encodeURIComponent(file)}`;
	return hash;
}
