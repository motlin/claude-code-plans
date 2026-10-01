import {
	Code,
	FileCog,
	Gauge,
	type LucideIcon,
	MessagesSquare,
	ScrollText,
	Server,
	Settings,
	Sparkles,
	Wrench,
} from "lucide-react";
import type {SettingsTab} from "../../lib/settings-hash";

/** The glyph shown before each Settings tab in the nav and in search-result breadcrumbs. */
export const SETTINGS_TAB_ICONS = {
	general: Settings,
	usage: Gauge,
	"claude-code": Code,
	transcript: ScrollText,
	sessions: MessagesSquare,
	application: Server,
	"ai-features": Sparkles,
	"claude-config": FileCog,
	setup: Wrench,
} satisfies Record<SettingsTab, LucideIcon>;
