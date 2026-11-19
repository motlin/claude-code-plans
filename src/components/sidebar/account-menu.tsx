import {useQuery} from "@tanstack/react-query";
import {useLocation, useNavigate} from "@tanstack/react-router";
import
{
	BookOpen,
	Bug,
	CircleHelp,
	ExternalLink,
	FileCog,
	Gauge,
	Info,
	ScrollText,
	Settings,
	Wrench,
} from "lucide-react";
import {useCallback, useLayoutEffect, useRef, useState, type ReactNode} from "react";
import {useShortcutKeys} from "../../hooks/use-shortcut";
import {localAccountQueryOptions} from "../../lib/api/local-account";
import {setKeyboardShortcutsOpen} from "../keyboard-shortcuts-open";
import {useOpenSettings} from "../settings/open-settings";
import
{
	Menu,
	MenuContent,
	MenuItem,
	MenuSeparator,
	MenuSub,
	MenuSubContent,
	MenuSubTrigger,
	MenuTrigger,
} from "../ui/menu";
import {nonEmpty} from "../../lib/non-empty";
import {Icon} from "../ui/icon";
import {Tooltip} from "../ui/tooltip";

/** Upstream's Learn more links; a separator sits between these two groups. */
const UPSTREAM_PRODUCT_LINKS = [
	{
		label: "Claude Platform",
		href: "https://platform.claude.com",
	},
	{
		label: "About Anthropic",
		href: "https://www.anthropic.com/",
	},
] as const;

const UPSTREAM_LEGAL_LINKS = [
	{
		label: "Claude Academy",
		href: "https://claude.ai/learning",
	},
	{
		label: "Usage policy",
		href: "https://www.anthropic.com/legal/aup",
	},
	{
		label: "Privacy policy",
		href: "https://www.anthropic.com/legal/privacy",
	},
	{
		label: "Terms of service",
		href: "https://www.anthropic.com/legal/consumer-terms",
	},
] as const;

const CLAUDE_CODE_LINKS = [
	{
		label: "Claude Code docs",
		href: "https://code.claude.com/docs",
		icon: <BookOpen />,
	},
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
export function AccountMenu()
{
	const {data} = useQuery(localAccountQueryOptions);
	const navigate = useNavigate();
	const openSettings = useOpenSettings();
	const pathname = useLocation(
		{
			select: (location) => location.pathname,
		},
	);
	const settingsTab = pathname === "/" || pathname.startsWith("/session/") ? "claude-code" : "general";
	const settingsKeys = useShortcutKeys("settings").keys;
	const shortcutsKeys = useShortcutKeys("shortcuts_modal").keys;
	const name = nonEmpty(data?.name) ?? "Local";
	const initial = nonEmpty(data?.initial) ?? name.charAt(0).toUpperCase();
	const planLabel = data?.planLabel;
	const tooltip = planLabel === undefined ? name : `${name} · ${planLabel}`;
	const wordsRef = useRef<HTMLSpanElement>(null);
	const [cut, setCut] = useState(false);
	/** Upstream's `pT`: the words are cut when any of their spans overflows; marks the plan `data-cut` to match. */
	const measureCut = useCallback(() =>
	{
		const words = wordsRef.current;
		const next =
			words !== null && [...words.querySelectorAll("span")].some((span) => span.scrollWidth > span.clientWidth);
		setCut(next);
		return next;
	}, []);

	useLayoutEffect(() =>
	{
		const words = wordsRef.current;
		measureCut();
		if (words === null || typeof ResizeObserver === "undefined") return undefined;
		const observer = new ResizeObserver(() =>
		{
			measureCut();
		});
		observer.observe(words);
		return () =>
		{
			observer.disconnect();
		};
	}, [measureCut, name, planLabel]);

	return (
		<Menu>
			<Tooltip content={tooltip} side="top" openWhen={measureCut} className="max-w-full min-w-0 align-top">
				<MenuTrigger
					data-testid="user-menu-button"
					data-prefetch="settings"
					className="df-user-menu-btn group/btn relative inline-flex h-7 max-w-full min-w-0 items-center justify-start gap-1.5 rounded-r6 ps-0.5 pe-3 align-top text-left hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent-100),0_0_6px_0_color-mix(in_srgb,var(--color-accent-100)_20%,transparent)]"
				>
					<span aria-hidden="true" className="absolute inset-0 -z-[1] rounded-[inherit]">
						<span
							data-cds-part="paint"
							className="absolute inset-0 rounded-[inherit] transition-[background-color] group-hover/btn:bg-fill-ghost-hover group-data-[popup-open]/btn:bg-fill-ghost-hover"
						/>
					</span>
					<span className="inline-flex min-w-0 items-center gap-1">
						<span className="df-on-rail relative flex w-[var(--sb-leading-slot)] shrink-0 items-center justify-center">
							<span
								aria-hidden="true"
								className="flex size-5 items-center justify-center rounded-full bg-fill-control text-[9px] font-medium text-primary select-none"
							>
								{initial}
							</span>
						</span>
						<span
							ref={wordsRef}
							className="df-user-menu-words df-footer-suffix flex min-w-0 items-baseline gap-1 overflow-hidden text-start text-[length:var(--sb-row-font)] leading-5"
						>
							<span className="df-footer-name max-w-full shrink-0 whitespace-nowrap text-secondary">
								{name}
							</span>
							{planLabel !== undefined && (
								<>
									<span
										aria-hidden="true"
										className="df-footer-suffix-text text-[length:calc(var(--sb-row-font)-2px)]/5 text-ink-muted"
									>
										·
									</span>
									<span
										data-cut={cut ? "" : undefined}
										className="df-footer-suffix-text text-[length:calc(var(--sb-row-font)-2px)]/5 min-w-0 whitespace-nowrap text-ink-muted"
									>
										{planLabel}
									</span>
								</>
							)}
						</span>
						<span className="-me-1 inline-flex">
							<Icon name="CaretDown" size="xs" className="df-user-menu-caret shrink-0 text-ink-muted" />
						</span>
					</span>
				</MenuTrigger>
			</Tooltip>
			<MenuContent density="comfortable" side="top" align="start" className="w-[17rem]">
				{data?.email !== undefined && (
					<div role="presentation" className="truncate px-2.5 py-1 text-footnote font-medium text-ink-muted">
						<span data-testid="user-menu-header">{data.email}</span>
					</div>
				)}
				<MenuItem
					data-testid="user-menu-settings"
					icon={<Settings />}
					shortcut={settingsKeys}
					onSelect={() =>
					{
						openSettings(settingsTab);
					}}
				>
					Settings
				</MenuItem>
				<MenuItem
					data-testid="user-menu-usage"
					icon={<Gauge />}
					onSelect={() =>
					{
						openSettings("usage");
					}}
				>
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
					onSelect={() =>
						void navigate(
							{
								to: "/settings/edit",
							},
						)
					}
				>
					Claude Config
				</MenuItem>
				<MenuItem
					data-testid="user-menu-setup"
					icon={<Wrench />}
					onSelect={() =>
						void navigate(
							{
								to: "/setup",
							},
						)
					}
				>
					Setup
				</MenuItem>
				<MenuSeparator />
				<MenuSub>
					<MenuSubTrigger data-testid="user-menu-learn-more" icon={<Info />}>
						Learn more
					</MenuSubTrigger>
					<MenuSubContent className="w-[208px]">
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
								<ExternalLabel compactGap>{link.label}</ExternalLabel>
							</MenuItem>
						))}
						<MenuSeparator />
						<MenuItem
							shortcut={shortcutsKeys}
							onSelect={() =>
							{
								setKeyboardShortcutsOpen(true);
							}}
						>
							Keyboard shortcuts
						</MenuItem>
					</MenuSubContent>
				</MenuSub>
			</MenuContent>
		</Menu>
	);
}

function ExternalLinkItem({href, children}: {href: string; children: ReactNode})
{
	return (
		<MenuItem render={<a href={href} target="_blank" rel="noreferrer" />}>
			<ExternalLabel>{children}</ExternalLabel>
		</MenuItem>
	);
}

function ExternalLabel({children, compactGap = false}: {children: ReactNode; compactGap?: boolean})
{
	return (
		<span className={`flex w-full min-w-0 items-center ${compactGap ? "gap-3" : "gap-6"}`}>
			<span className="min-w-0 flex-1 truncate">{children}</span>
			<ExternalLink aria-hidden="true" className="size-4 shrink-0 text-primary" />
		</span>
	);
}
