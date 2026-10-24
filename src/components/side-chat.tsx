import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";

import {closeSideChat, setSideChatMode, useSideChat} from "../lib/side-chat-store";
import {deferredComponent, deferredModule} from "./deferred-component";
import {registerPane} from "./panes/pane-registry";
import {useOptionalPaneHost} from "./panes/pane-host-context";
import {useToast} from "./toast-context";
import {ViewportPortal} from "./viewport-portal";

// The side chat's thread and input stay off the session's cold load; the closed card is invisible until they arrive.
const sideChatPanel = deferredModule(async () =>
	import("./side-chat-panel").then(({SideChatPanel}) => ({SideChatPanel})),
);

/** The side chat panel's one download, warmed when the session page goes idle. */
export const preloadSideChatPanel = sideChatPanel.preload;
const SideChatPanel = deferredComponent(sideChatPanel, "SideChatPanel");

const ASIDE_CLASS =
	"fixed right-4 bottom-4 z-40 flex w-[400px] max-w-[calc(100vw-2rem)] max-h-[min(560px,calc(100vh-2rem))] invisible pointer-events-none origin-bottom-right scale-95 flex-col overflow-hidden rounded-card border-[0.5px] border-strong bg-surface-3 opacity-0 shadow-[0_24px_60px_color-mix(in_srgb,black_18%,transparent),0_4px_16px_color-mix(in_srgb,black_8%,transparent)] transition-[opacity,transform,visibility] duration-200 ease-out data-[open]:visible data-[open]:pointer-events-auto data-[open]:scale-100 data-[open]:opacity-100";

const POPOUT_BLOCKED_MESSAGE = "Couldn’t open a new window. Allow pop-ups for this site.";

/**
 * claude.ai/code's side chat for quick questions about this session. Each
 * question runs as an ephemeral fork, so nothing is added to the session
 * itself. It shows as a floating card, docks as the `side-chat` pane when a
 * pane host is present, or pops out to its own window; the Q/A thread lives
 * in the side chat store, so it survives every switch.
 */
export function SideChat({sessionId, messageCount}: {sessionId: string; messageCount: number}) {
	const {open, mode} = useSideChat(sessionId);
	const host = useOptionalPaneHost();
	const canDock = host !== null;
	const floating = mode === "floating" || (mode === "docked" && !canDock);
	const floatingOpen = open && floating;
	const popoutRoot = usePopoutWindow(sessionId, open && mode === "popout");
	useDockedSideChat(sessionId, messageCount, open && mode === "docked");

	return (
		<>
			<ViewportPortal>
				<aside
					aria-label="Side chat"
					data-focus-region="side-chat"
					data-open={floatingOpen ? "" : undefined}
					aria-hidden={floatingOpen ? undefined : true}
					inert={!floatingOpen}
					className={ASIDE_CLASS}
				>
					{floating && (
						<SideChatPanel
							sessionId={sessionId}
							messageCount={messageCount}
							variant="floating"
							active={floatingOpen}
							canDock={canDock}
						/>
					)}
				</aside>
			</ViewportPortal>
			{popoutRoot !== null &&
				createPortal(
					<SideChatPanel
						sessionId={sessionId}
						messageCount={messageCount}
						variant="popout"
						active
						canDock={false}
					/>,
					popoutRoot,
				)}
		</>
	);
}

/**
 * Registers the `side-chat` pane kind while a pane host is present, and keeps
 * the pane open exactly while the side chat is open and docked: docking opens
 * it, undocking or closing the side chat closes it, and closing the pane from
 * the host (⌘\) closes the side chat.
 */
function useDockedSideChat(sessionId: string, messageCount: number, docked: boolean): void {
	const host = useOptionalPaneHost();
	const hasHost = host !== null;

	useEffect(() => {
		if (!hasHost) return undefined;
		return registerPane("side-chat", {
			title: "Side chat",
			header: "custom",
			render: (chrome) => (
				<SideChatPanel
					sessionId={sessionId}
					messageCount={messageCount}
					variant="docked"
					active
					canDock
					chrome={chrome}
				/>
			),
		});
	}, [hasHost, sessionId, messageCount]);

	const paneOpen = host?.isOpen("side-chat") ?? false;
	const wasPaneOpen = useRef(paneOpen);
	useEffect(() => {
		if (host === null) return;
		const closedByHost = wasPaneOpen.current && !paneOpen;
		wasPaneOpen.current = paneOpen;
		if (closedByHost && docked) closeSideChat(sessionId);
		else if (docked && !paneOpen) host.openPane("side-chat");
		else if (!docked && paneOpen) host.closePane("side-chat");
	}, [host, paneOpen, docked, sessionId]);
}

/** Copies the page's stylesheets and theme onto a pop-out window's document. */
function adoptPageStyles(target: Document): void {
	for (const node of document.head.querySelectorAll("style, link[rel='stylesheet']")) {
		const clone = node.cloneNode(true);
		if (node instanceof HTMLLinkElement && clone instanceof HTMLLinkElement) clone.href = node.href;
		target.head.append(clone);
	}
	for (const {name, value} of document.documentElement.attributes) {
		if (name === "class" || name === "style" || name.startsWith("data-")) {
			target.documentElement.setAttribute(name, value);
		}
	}
	target.body.className = "m-0 bg-surface-3 text-primary";
}

/**
 * Opens the side chat's pop-out window while `active` and returns the element
 * to portal into. The window closing on its own drops back to the floating
 * card; a blocked pop-up does too, with a toast.
 */
function usePopoutWindow(sessionId: string, active: boolean): HTMLElement | null {
	const toast = useToast();
	const [root, setRoot] = useState<HTMLElement | null>(null);

	useEffect(() => {
		if (!active) return undefined;
		const popup = window.open("", `side-chat-${sessionId}`, "popup,width=420,height=640");
		if (popup === null) {
			setSideChatMode(sessionId, "floating");
			toast({kind: "error", message: POPOUT_BLOCKED_MESSAGE});
			return undefined;
		}
		popup.document.title = "Side chat";
		adoptPageStyles(popup.document);
		const container = popup.document.createElement("div");
		container.className = "flex h-dvh flex-col";
		popup.document.body.append(container);
		const onPageHide = () => {
			setSideChatMode(sessionId, "floating");
		};
		popup.addEventListener("pagehide", onPageHide);
		setRoot(container);
		return () => {
			popup.removeEventListener("pagehide", onPageHide);
			setRoot(null);
			container.remove();
			popup.close();
		};
	}, [active, sessionId, toast]);

	return root;
}
