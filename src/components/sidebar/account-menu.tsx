import {useQuery} from "@tanstack/react-query";
import {useNavigate} from "@tanstack/react-router";
import {
	ArrowUpRight,
	BookOpen,
	Bug,
	ChevronDown,
	CircleHelp,
	FileCog,
	Gauge,
	Info,
	ScrollText,
	Settings,
	Wrench,
} from "lucide-react";
import type {ReactNode} from "react";
import {useShortcutKeys} from "../../hooks/use-shortcut";
import {localAccountQueryOptions} from "../../lib/api/local-account";
import {setKeyboardShortcutsOpen} from "../keyboard-shortcuts-dialog";
import {useOpenSettings} from "../settings/settings-dialog";
import {
	Menu,
	MenuContent,
	MenuItem,
	MenuSeparator,
	MenuSub,
	MenuSubContent,
	MenuSubTrigger,
	MenuTrigger,
} from "../ui/menu";

/** Upstream's Learn more links; a separator sits between these two groups. */
const UPSTREAM_PRODUCT_LINKS = [
	{label: "Claude Platform", href: "https://platform.claude.com"},
	{label: "About Anthropic", href: "https://www.anthropic.com/"},
] as const;

const UPSTREAM_LEGAL_LINKS = [
	{label: "Claude Academy", href: "https://claude.ai/learning"},
	{label: "Usage policy", href: "https://www.anthropic.com/legal/aup"},
	{label: "Privacy policy", href: "https://www.anthropic.com/legal/privacy"},
	{label: "Terms of service", href: "https://www.anthropic.com/legal/consumer-terms"},
] as const;

const CLAUDE_CODE_LINKS = [
	{label: "Claude Code docs", href: "https://code.claude.com/docs", icon: <BookOpen />},
	{
		label: "Changelog",
		href: "https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md",
		icon: <ScrollText />,
	},
	{
		label: "Report an issue",
		href: "https://github.com/anthropics/claude-code/issues",
		icon: <Bug />,
	},
] as const;

/**
 * Upstream's footer user button (`[data-testid=user-menu-button]`) and the account menu it opens
 * above itself. Cloud-only items (Language, View all plans, Get apps, Log out, Your privacy choices) are
 * omitted; Claude Config and Setup are local additions.
 */
export function AccountMenu() {
	const {data} = useQuery(localAccountQueryOptions);
	const navigate = useNavigate();
	const openSettings = useOpenSettings();
	const settingsKeys = useShortcutKeys("settings").keys;
	const shortcutsKeys = useShortcutKeys("shortcuts_modal").keys;
	const name = data?.name || "Local";
	const initial = data?.initial || name.charAt(0).toUpperCase();

	return (
		<Menu>
			<MenuTrigger
				data-testid="user-menu-button"
				className="flex h-8 max-w-full min-w-0 items-center gap-2 rounded-r6 pr-2 pl-0.5 text-left outline-none hover:bg-[var(--sb-hover)] focus-visible:bg-[var(--sb-hover)] data-[popup-open]:bg-[var(--sb-hover)]"
			>
				<span className="flex h-7 w-7 shrink-0 items-center justify-center">
					<span
						aria-hidden="true"
						className="flex size-6 items-center justify-center rounded-full bg-fill-control text-[9px] font-medium text-primary select-none"
					>
						{initial}
					</span>
				</span>
				<span className="flex min-w-0 items-baseline gap-1 overflow-hidden text-[14px] leading-[21px]">
					<span className="max-w-full shrink-0 truncate whitespace-nowrap text-secondary">{name}</span>
					{data?.planLabel !== undefined && (
						<>
							<span aria-hidden="true" className="text-[12px]/[18px] text-ink-muted">
								·
							</span>
							<span className="min-w-0 whitespace-nowrap text-[12px]/[18px] text-ink-muted">
								{data.planLabel}
							</span>
						</>
					)}
				</span>
				<ChevronDown aria-hidden="true" className="size-3 shrink-0 text-ink-muted" />
			</MenuTrigger>
			<MenuContent density="comfortable" side="top" align="start" className="w-[17rem]">
				{data?.email !== undefined && (
					<div role="presentation" className="truncate px-2.5 py-1 text-[12px]/[16px] font-medium text-muted">
						<span data-testid="user-menu-header">{data.email}</span>
					</div>
				)}
				<MenuItem
					data-testid="user-menu-settings"
					icon={<Settings />}
					shortcut={settingsKeys}
					onSelect={() => openSettings("general")}
				>
					Settings
				</MenuItem>
				<MenuItem data-testid="user-menu-usage" icon={<Gauge />} onSelect={() => openSettings("usage")}>
					Usage
				</MenuItem>
				<MenuItem
					data-testid="user-menu-get-help"
					icon={<CircleHelp />}
					render={<a href="https://support.claude.com" target="_blank" rel="noreferrer" />}
				>
					<ExternalLabel>Get help</ExternalLabel>
				</MenuItem>
				<MenuSeparator />
				<MenuItem
					data-testid="user-menu-claude-config"
					icon={<FileCog />}
					onSelect={() => void navigate({to: "/settings/edit"})}
				>
					Claude Config
				</MenuItem>
				<MenuItem
					data-testid="user-menu-setup"
					icon={<Wrench />}
					onSelect={() => void navigate({to: "/setup"})}
				>
					Setup
				</MenuItem>
				<MenuSeparator />
				<MenuSub>
					<MenuSubTrigger data-testid="user-menu-learn-more" icon={<Info />}>
						Learn more
					</MenuSubTrigger>
					<MenuSubContent className="w-[208px]" sideOffset={6}>
						{UPSTREAM_PRODUCT_LINKS.map((link) => (
							<ExternalLinkItem key={link.href} href={link.href}>
								{link.label}
							</ExternalLinkItem>
						))}
						<MenuSeparator />
						{UPSTREAM_LEGAL_LINKS.map((link) => (
							<ExternalLinkItem key={link.href} href={link.href}>
								{link.label}
							</ExternalLinkItem>
						))}
						{CLAUDE_CODE_LINKS.map((link) => (
							<MenuItem
								key={link.href}
								icon={link.icon}
								render={<a href={link.href} target="_blank" rel="noreferrer" />}
							>
								<ExternalLabel>{link.label}</ExternalLabel>
							</MenuItem>
						))}
						<MenuSeparator />
						<MenuItem shortcut={shortcutsKeys} onSelect={() => setKeyboardShortcutsOpen(true)}>
							Keyboard shortcuts
						</MenuItem>
					</MenuSubContent>
				</MenuSub>
			</MenuContent>
		</Menu>
	);
}

function ExternalLinkItem({href, children}: {href: string; children: ReactNode}) {
	return (
		<MenuItem render={<a href={href} target="_blank" rel="noreferrer" />}>
			<ExternalLabel>{children}</ExternalLabel>
		</MenuItem>
	);
}

function ExternalLabel({children}: {children: ReactNode}) {
	return (
		<span className="inline-flex items-center gap-1">
			{children}
			<ArrowUpRight aria-hidden="true" className="size-3.5 text-muted" />
		</span>
	);
}
