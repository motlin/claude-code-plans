import {Dialog} from "@base-ui/react/dialog";
import {useQueryClient} from "@tanstack/react-query";
import {useNavigate, useRouterState} from "@tanstack/react-router";
import {Bot, Brain, CornerDownLeft, FileText, FolderOpen, MessageSquare, SquareSlash} from "lucide-react";
import {type ReactNode, useEffect, useRef, useState} from "react";

import {getCachedSessionIdentity} from "../lib/api/session-identity";
import {
	loadRecents,
	resolveRecentSession,
	resolveRecentSessions,
	routeToRecent,
	type RecentEntry,
	type RecentKind,
} from "../lib/recents-history";
import {
	currentSwitcherPlatform,
	initialIndex,
	isSwitchTrigger,
	type SwitchDirection,
	step,
	switchModifier,
} from "../lib/recents-switcher-keys";

const KIND_ICONS = {
	session: <MessageSquare />,
	subagents: <Bot />,
	plan: <FileText />,
	memory: <Brain />,
	project: <FolderOpen />,
	command: <SquareSlash />,
} as const satisfies Record<RecentKind, ReactNode>;

/** Where ⌃Q yields so the terminal receives it, like upstream's `[data-ccd-terminal]` guard. */
const TERMINAL_SELECTOR = "[data-terminal], canvas, [role='application']";

interface SwitcherState {
	entries: RecentEntry[];
	index: number;
}

function rowId(index: number): string {
	return `recents-switcher-row-${index}`;
}

function inTerminal(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(TERMINAL_SELECTOR) !== null;
}

/**
 * The upstream ⌃Q HistorySwitcher: an Alt-Tab style overlay over the per-tab recents MRU. Tap ⌃Q to
 * jump to the previous page, hold ⌃ and tap Q to walk further, ⇧ to reverse; releasing the modifier
 * or Enter commits, Esc or window blur cancels. Windows uses Alt+Q.
 */
export function RecentsSwitcher() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const pathname = useRouterState({select: (state) => state.location.pathname});
	const contextRef = useRef({queryClient, navigate, pathname});
	contextRef.current = {queryClient, navigate, pathname};
	const resolveAlias = (alias: string) => getCachedSessionIdentity(contextRef.current.queryClient, alias);
	const [state, setState] = useState<SwitcherState | null>(null);
	const stateRef = useRef<SwitcherState | null>(null);
	const listboxRef = useRef<HTMLDivElement>(null);

	const update = (next: SwitcherState | null) => {
		stateRef.current = next;
		setState(next);
	};
	const commitRef = useRef((index: number) => {
		const selected = stateRef.current?.entries[index];
		update(null);
		if (selected === undefined) return;
		// Keep the gesture's known local owner even if its saved alias changes before release.
		const entry = resolveRecentSession(selected, resolveAlias);
		const currentKey = routeToRecent(contextRef.current.pathname, resolveAlias)?.key;
		if (entry.key === currentKey) return;
		void contextRef.current.navigate({to: entry.href});
	});

	useEffect(() => {
		const move = (direction: SwitchDirection) => {
			const current = stateRef.current;
			if (current === null) return;
			update({
				...current,
				index: step(current.index, direction, current.entries.length),
			});
		};

		const onKeyDown = (event: KeyboardEvent) => {
			const platform = currentSwitcherPlatform();
			const current = stateRef.current;
			if (isSwitchTrigger(event, platform)) {
				const direction: SwitchDirection = event.shiftKey ? -1 : 1;
				if (current === null) {
					if (inTerminal(event.target)) return;
					const entries = resolveRecentSessions(loadRecents(), resolveAlias);
					if (entries.length === 0) return;
					const currentKey = routeToRecent(contextRef.current.pathname, resolveAlias)?.key ?? null;
					update({entries, index: initialIndex(entries, currentKey, direction)});
				} else {
					move(direction);
				}
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			if (current === null) return;
			switch (event.key) {
				case "ArrowDown":
					move(1);
					break;
				case "ArrowUp":
					move(-1);
					break;
				case "Enter":
					commitRef.current(current.index);
					break;
				case "Escape":
					update(null);
					break;
				default:
					return;
			}
			event.preventDefault();
			event.stopPropagation();
		};

		const onKeyUp = (event: KeyboardEvent) => {
			const current = stateRef.current;
			if (current === null) return;
			const modifier = switchModifier(currentSwitcherPlatform());
			const held = modifier === "Alt" ? event.altKey : event.ctrlKey;
			if (event.key === modifier || !held) commitRef.current(current.index);
		};

		const onBlur = () => update(null);

		document.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("keyup", onKeyUp);
		window.addEventListener("blur", onBlur);
		return () => {
			document.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("blur", onBlur);
		};
	}, []);

	useEffect(() => {
		if (stateRef.current !== null) update(null);
	}, [pathname]);

	const index = state?.index;
	useEffect(() => {
		if (index === undefined) return;
		document.getElementById(rowId(index))?.scrollIntoView({block: "nearest"});
	}, [index]);

	return (
		<Dialog.Root
			open={state !== null}
			onOpenChange={(open) => {
				if (!open) update(null);
			}}
		>
			<Dialog.Portal>
				<Dialog.Backdrop className="fixed inset-0 z-50 bg-backdrop backdrop-blur-[2px]" />
				<Dialog.Popup
					data-command-palette=""
					initialFocus={listboxRef}
					className="fixed left-1/2 z-50 w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 overflow-hidden rounded-[calc(var(--radius-composer)+0.375rem)] border-[0.5px] border-strong bg-surface-3 shadow-2xl outline-none md:w-[calc(100vw-5rem)]"
					style={{top: "max(1rem, min(25vh, calc(50vh - 220px)))"}}
				>
					<Dialog.Title className="sr-only">Recents</Dialog.Title>
					{state === null ? null : (
						<div
							ref={listboxRef}
							role="listbox"
							aria-label="Recents"
							aria-activedescendant={rowId(state.index)}
							tabIndex={-1}
							className="max-h-[440px] scroll-py-2.5 overflow-y-auto p-2.5 outline-none"
						>
							{state.entries.map((entry, i) => {
								const selected = i === state.index;
								return (
									<button
										key={entry.key}
										type="button"
										role="option"
										id={rowId(i)}
										aria-selected={selected}
										tabIndex={-1}
										onClick={() => commitRef.current(i)}
										className="flex w-full items-center justify-between gap-3 truncate rounded-lg px-3 py-2 text-left text-sm leading-5 text-secondary hover:bg-fill-ghost-hover aria-selected:bg-fill-ghost-hover aria-selected:text-primary"
									>
										<span className="flex min-w-0 items-center gap-2 [&>svg]:size-5 [&>svg]:shrink-0">
											{KIND_ICONS[entry.kind]}
											<span className="truncate">{entry.title ?? "Untitled"}</span>
										</span>
										{selected ? (
											<span className="inline-flex shrink-0 text-xs text-ink-muted pointer-coarse:hidden">
												<CornerDownLeft aria-hidden="true" className="size-4" />
											</span>
										) : null}
									</button>
								);
							})}
						</div>
					)}
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
