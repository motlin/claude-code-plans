import {type KeyboardEvent, type MouseEvent, useId, useState} from "react";

import {closeSideChat, setSideChatMode} from "../lib/side-chat-store";
import {Icon} from "./ui/icon";
import {ContextMenu, ContextMenuTrigger, MenuContent, MenuItem, MenuSeparator} from "./ui/menu";

/** Upstream's vertical tab bar list (cfe7c4b3b `Ab` dress `list`), the side chat strip's `role=tablist`. */
const TABLIST_CLASS = [
	"relative isolate -mx-[4px] flex min-w-0 select-none items-center overflow-x-hidden p-[4px] draggable-none",
	"-my-[4px] gap-0.5 pointer-events-none *:pointer-events-auto",
	"before:pointer-events-auto before:flex-none before:self-stretch after:pointer-events-auto after:flex-none after:self-stretch",
	"before:order-1 after:order-1 [&>[data-vtb-end-slack]]:order-2",
	"before:w-[100000px] before:-ms-[100000px] before:-me-0.5",
	"after:w-[4px] after:-ms-0.5 after:-me-[4px]",
].join(" ");

const TABLIST_STYLE =
{
	"--vtb-pill-h": "var(--cds-h-control)",
	"--vtb-pill-corner": "var(--cds-radius)",
};

const TAB_BOX_CLASS =
	"group/tab isolate flex select-none relative min-w-[calc(var(--cds-icon)_+_2*var(--cds-pad-md))] h-control basis-[212px] items-center overflow-clip text-body gap-[4px] rounded py-1 ps-md has-[:focus-visible]:shadow-focus justify-end text-primary";

const TAB_FILL_CLASS =
	"absolute inset-0 -z-[1] rounded-[inherit] group-hover/tab:bg-fill-ghost-hover group-data-[popup-open]/tab:bg-fill-ghost-hover !bg-fill-ghost-selected";

const TAB_CLASS =
	"flex h-full flex-1 items-center outline-none gap-1.5 before:absolute before:inset-0 before:-z-[1] min-w-0";

const TAB_LABEL_CLASS =
	"flex h-full min-w-0 max-w-[140px] flex-1 items-center overflow-x-clip [&:where(:root[dir=rtl]_:dir(ltr))]:justify-end-safe";

const TAB_CLOSE_CLASS =
	"grid shrink-0 place-items-center me-[calc((var(--vtb-pill-h)_-_var(--cds-h-control))/2)] rounded-[calc(var(--vtb-pill-corner)_-_(var(--vtb-pill-h)_-_var(--cds-h-control))/2)] hover:bg-fill-ghost-hover text-muted-as-secondary hover:text-primary group-data-[selected]/tab:text-primary size-control";

/** Upstream `tabWidth 160` + `extraChromePx 20`, floored at `minTabWidth 92` or the strip's room. */
const TAB_BOX_STYLE =
{
	minWidth: "calc(min(92px, var(--vtb-room, 92px)) + 0px)",
	flexBasis: 180,
	width: 180,
};

/** Upstream's end slack: the floor (`minTabWidth 92`) plus the 2px tab gap. */
const END_SLACK_STYLE =
{
	width: 94,
};

const CLOSE_HINT = "Press Delete or Backspace to close the side chat. A working side chat is stopped first.";

/**
 * Upstream's docked side chat header strip (c9bd7af9c `NL` over the shared vertical tab bar): one solo, selected,
 * icon-less "Side chat" tab that is closable anyway. The X, Delete/Backspace, a middle click and the tab menu's Close
 * all close (and so discard) the side chat. The menu also carries the local Undock / Open in new window extras.
 */
export function SideChatTabStrip({sessionId, status}: {sessionId: string; status: "Working" | "Stopping…" | null})
{
	const hintId = useId();
	const [menuOpen, setMenuOpen] = useState(false);

	function close()
	{
		closeSideChat(sessionId);
	}

	function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>)
	{
		if (event.key !== "Delete" && event.key !== "Backspace") return;
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		event.preventDefault();
		if (event.repeat) return;
		close();
	}

	function onBoxMouseDown(event: MouseEvent<HTMLDivElement>)
	{
		if (event.button === 1) event.preventDefault();
	}

	function onBoxAuxClick(event: MouseEvent<HTMLDivElement>)
	{
		if (event.button !== 1) return;
		event.preventDefault();
		close();
	}

	const popupOpen = menuOpen ? "" : undefined;

	return (
		<div className="relative flex min-w-0 flex-1 items-center gap-1">
			{/* Upstream's drag-region filler; its desktop-only `draggable` (app-region) class has no web counterpart. */}
			<div aria-hidden="true" className="absolute inset-0 -z-[1]" />
			<div
				data-orientation="horizontal"
				data-view-tab-bar=""
				className="flex min-w-0 flex-1 items-center gap-[4px] font-sans select-none"
			>
				<div role="tablist" aria-label="Side chat tabs" className={TABLIST_CLASS} style={TABLIST_STYLE}>
					<ContextMenu onOpenChange={setMenuOpen}>
						<ContextMenuTrigger
							render={<div />}
							role="presentation"
							data-vtb-id={`side-chat:${sessionId}`}
							data-selected="true"
							data-vtb-solo="true"
							data-vtb-no-icon=""
							data-popup-open={popupOpen}
							data-pressed={popupOpen}
							style={TAB_BOX_STYLE}
							className={TAB_BOX_CLASS}
							onMouseDown={onBoxMouseDown}
							onAuxClick={onBoxAuxClick}
						>
							<span aria-hidden="true" className={TAB_FILL_CLASS} />
							<div
								role="tab"
								tabIndex={0}
								aria-selected="true"
								aria-posinset={1}
								aria-setsize={1}
								aria-describedby={hintId}
								className={TAB_CLASS}
								onKeyDown={onTabKeyDown}
							>
								<span
									data-vtb-label="true"
									style={
									{
										maxWidth: "none",
									}}
									className={TAB_LABEL_CLASS}
								>
									<span className="text-start whitespace-nowrap">Side chat</span>
									{status !== null && <span className="sr-only">, {status}</span>}
								</span>
							</div>
							<button
								type="button"
								tabIndex={-1}
								aria-hidden="true"
								aria-label="Close side chat"
								data-size="xs"
								className={TAB_CLOSE_CLASS}
								onClick={close}
							>
								<Icon name="X" size="sm" />
							</button>
						</ContextMenuTrigger>
						<MenuContent>
							<MenuItem
								onSelect={() =>
								{
									setSideChatMode(sessionId, "floating");
								}}
							>
								Undock side chat
							</MenuItem>
							<MenuItem
								onSelect={() =>
								{
									setSideChatMode(sessionId, "popout");
								}}
							>
								Open in new window
							</MenuItem>
							<MenuSeparator />
							<MenuItem onSelect={close}>Close side chat</MenuItem>
						</MenuContent>
					</ContextMenu>
					<span data-vtb-end-slack="" aria-hidden="true" style={END_SLACK_STYLE} />
				</div>
				<span id={hintId} className="sr-only">
					{CLOSE_HINT}
				</span>
			</div>
		</div>
	);
}
