import {useEffect, useRef, useState} from "react";
import {
	decodeTerminalBytes,
	encodeTerminalText,
	parseShellServerFrame,
	type ShellClientFrame,
} from "../lib/herdr/terminal-protocol";
import {useTerminalTheme} from "../hooks/use-terminal-theme";
import type {GhosttyAppearance} from "../lib/server-fns";
import {applyTerminalTheme} from "../lib/terminal-theme";
import {
	formatLinkMessage,
	INITIAL_TERMINAL_LIFECYCLE,
	reduceTerminalLifecycle,
	type TerminalLifecycle,
	type TerminalLifecycleEvent,
	terminalOverlay,
	terminalStatus,
} from "../lib/terminal-lifecycle";
import {type ConnectionStatus, loadGhostty} from "./herdr-terminal";
import {TerminalPlaceholder} from "./terminal-placeholder";
import {installTerminalInput, TerminalSelectionStatus, useTerminalSelectionActions} from "./terminal-selection-status";

/** Socket closes that mean "stop", not "reconnect". */
const FINAL_CLOSE_CODES = new Set([1000, 1008, 4001, 4404]);

function shellSocketUrl(ptyKey: string): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${window.location.host}/api/shell/${encodeURIComponent(ptyKey)}`;
}

const OVERLAY_BUTTON_CLASS =
	"h-7 cursor-pointer rounded-r6 border border-strong px-2.5 text-body text-primary transition-colors hover:bg-fill-ghost-hover focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none disabled:cursor-default disabled:opacity-50";

/**
 * One Shell tab: a login `$SHELL` PTY on the server, attached over
 * `/api/shell/$ptyKey`. Reconnects replay the PTY's buffered output, so a
 * dropped socket or a re-mounted pane picks up where it left off, with dim
 * in-band lines saying the connection went and came back. Once the shell
 * exits or the socket fails for good, an overlay offers Restart shell (a new
 * PTY for this tab via `onRestart`) and Reconnect (the same PTY).
 * `closeRequested` sends the close frame, which ends the PTY, then reports
 * `onClosed` so the tab can go. Without a live socket the idle timeout on the
 * server reaps the PTY instead.
 */
export function ShellTerminal({
	sessionId,
	ptyKey,
	closeRequested,
	onClosed,
	onRestart,
	onStatusChange,
}: {
	/** The session whose composer ⇧⌘L attaches the selection to. */
	sessionId: string;
	ptyKey: string;
	closeRequested: boolean;
	onClosed: () => void;
	/** Start a new shell for this tab; rejects with the reason it could not. */
	onRestart: () => Promise<void>;
	onStatusChange?: (status: ConnectionStatus) => void;
}) {
	const container = useRef<HTMLDivElement>(null);
	const sendRef = useRef<((frame: ShellClientFrame) => boolean) | null>(null);
	const reconnectRef = useRef<(() => void) | null>(null);
	const dispatchRef = useRef<(event: TerminalLifecycleEvent) => void>(() => {});
	const restartingRef = useRef(false);
	const onClosedRef = useRef(onClosed);
	onClosedRef.current = onClosed;
	const [lifecycle, setLifecycle] = useState<TerminalLifecycle>(INITIAL_TERMINAL_LIFECYCLE);
	const [restarting, setRestarting] = useState(false);
	const [appearance, setAppearance] = useState<GhosttyAppearance | null>(null);
	const {actions: selectionActions, announcement} = useTerminalSelectionActions(sessionId);
	const {ready: themeReady, theme: codeTheme} = useTerminalTheme();

	useEffect(() => {
		const element = container.current;
		if (!element || !themeReady) return;

		let disposed = false;
		let teardown: (() => void) | null = null;
		let terminalWrite: ((text: string) => void) | null = null;
		let state = restartingRef.current
			? reduceTerminalLifecycle(INITIAL_TERMINAL_LIFECYCLE, {type: "restart"}).state
			: INITIAL_TERMINAL_LIFECYCLE;
		restartingRef.current = false;
		setLifecycle(state);

		const dispatch = (event: TerminalLifecycleEvent): void => {
			if (disposed) return;
			const step = reduceTerminalLifecycle(state, event);
			state = step.state;
			setLifecycle(state);
			if (step.link !== null) terminalWrite?.(formatLinkMessage(step.link, window.location.host));
		};
		dispatchRef.current = dispatch;

		const start = (ghostty: typeof import("ghostty-web"), ghosttyAppearance: GhosttyAppearance): (() => void) => {
			const terminal = new ghostty.Terminal({
				convertEol: false,
				cursorBlink: true,
				fontFamily: ghosttyAppearance.fontFamily,
				fontSize: ghosttyAppearance.fontSize,
				scrollback: 10_000,
				theme: ghosttyAppearance.theme,
			});
			const fitAddon = new ghostty.FitAddon();
			terminal.loadAddon(fitAddon);
			terminal.open(element);
			terminalWrite = (text) => terminal.write(text);
			installTerminalInput(terminal, selectionActions);

			let socket: WebSocket | null = null;
			let retry: ReturnType<typeof setTimeout> | null = null;
			let resizeTimer: ReturnType<typeof setTimeout> | null = null;
			let stopped = false;

			const send = (frame: ShellClientFrame): boolean => {
				if (socket?.readyState !== WebSocket.OPEN) return false;
				socket.send(JSON.stringify(frame));
				return true;
			};
			sendRef.current = send;
			const dataSubscription = terminal.onData((data) => send({type: "data", data: encodeTerminalText(data)}));
			const sendSize = (): void => {
				fitAddon.fit();
				send({type: "resize", cols: terminal.cols, rows: terminal.rows});
			};

			const connect = (): void => {
				if (stopped) return;
				retry = null;
				const nextSocket = new WebSocket(shellSocketUrl(ptyKey));
				socket = nextSocket;

				nextSocket.addEventListener("open", sendSize);
				nextSocket.addEventListener("message", (event) => {
					let frame;
					try {
						frame = parseShellServerFrame(String(event.data));
					} catch {
						stopped = true;
						dispatch({type: "error", message: "invalid shell frame"});
						nextSocket.close(4000, "invalid shell frame");
						return;
					}
					switch (frame.type) {
						case "opened":
							terminal.reset();
							terminal.write(decodeTerminalBytes(frame.buffered));
							dispatch({type: "opened"});
							return;
						case "data":
							terminal.write(decodeTerminalBytes(frame.data));
							return;
						case "exit":
							stopped = true;
							dispatch({type: "exited"});
							return;
						case "error":
							stopped = true;
							// A missing PTY is a shell that is gone, not a broken connection.
							dispatch(
								frame.message === "Shell not found"
									? {type: "exited"}
									: {type: "error", message: frame.message},
							);
					}
				});
				nextSocket.addEventListener("close", (event) => {
					if (socket !== nextSocket) return;
					socket = null;
					if (event.code === 4404) {
						stopped = true;
						dispatch({type: "exited"});
					}
					if (stopped || FINAL_CLOSE_CODES.has(event.code)) {
						stopped = true;
						return;
					}
					dispatch({type: "lost"});
					retry = setTimeout(connect, 750);
				});
			};

			reconnectRef.current = () => {
				if (retry) clearTimeout(retry);
				socket?.close(1000, "shell reconnecting");
				socket = null;
				stopped = false;
				dispatch({type: "reconnect"});
				connect();
			};

			const resizeObserver = new ResizeObserver(() => {
				if (resizeTimer) clearTimeout(resizeTimer);
				resizeTimer = setTimeout(sendSize, 150);
			});
			resizeObserver.observe(element);
			fitAddon.fit();
			connect();

			return () => {
				stopped = true;
				sendRef.current = null;
				reconnectRef.current = null;
				terminalWrite = null;
				if (retry) clearTimeout(retry);
				if (resizeTimer) clearTimeout(resizeTimer);
				resizeObserver.disconnect();
				dataSubscription.dispose();
				socket?.close(1000, "shell view closed");
				terminal.dispose();
			};
		};

		void loadGhostty()
			.then(({ghostty, appearance: loadedAppearance}) => {
				if (disposed) return;
				const ghosttyAppearance = applyTerminalTheme(loadedAppearance, codeTheme);
				setAppearance(ghosttyAppearance);
				dispatch({type: "loaded"});
				teardown = start(ghostty, ghosttyAppearance);
			})
			.catch(() => dispatch({type: "load-failed"}));

		return () => {
			disposed = true;
			teardown?.();
		};
	}, [ptyKey, selectionActions, themeReady, codeTheme]);

	useEffect(() => {
		if (!closeRequested) return;
		sendRef.current?.({type: "close"});
		onClosedRef.current();
	}, [closeRequested]);

	const status = terminalStatus(lifecycle);
	useEffect(() => {
		onStatusChange?.(status);
	}, [onStatusChange, status]);

	const restart = (): void => {
		setRestarting(true);
		restartingRef.current = true;
		onRestart()
			.catch((cause: unknown) => {
				restartingRef.current = false;
				dispatchRef.current({
					type: "start-failed",
					message: cause instanceof Error ? cause.message : String(cause),
				});
			})
			.finally(() => setRestarting(false));
	};

	const overlay = terminalOverlay(lifecycle);

	return (
		<div className="relative flex h-full min-h-0 flex-col">
			<div
				ref={container}
				data-terminal=""
				className="min-h-0 flex-1 overflow-hidden rounded-b-[inherit] p-2"
				style={appearance ? {backgroundColor: appearance.theme.background} : undefined}
			/>
			{overlay?.kind === "placeholder" && <TerminalPlaceholder appearance={appearance} />}
			<TerminalSelectionStatus announcement={announcement} />
			{overlay?.kind === "load-failed" && (
				<p
					role="alert"
					className="absolute inset-x-0 bottom-0 bg-surface-1 px-3 py-2 text-caption text-danger-000"
				>
					{overlay.title}
				</p>
			)}
			{overlay?.kind === "ended" && (
				<div
					role="alert"
					className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 border-t border-strong bg-surface-1 px-3 py-2"
				>
					<div className="min-w-0 flex-1">
						<p className="text-body text-primary">{overlay.title}</p>
						{overlay.detail !== null && <p className="text-caption text-secondary">{overlay.detail}</p>}
					</div>
					<button type="button" disabled={restarting} onClick={restart} className={OVERLAY_BUTTON_CLASS}>
						Restart shell
					</button>
					<button
						type="button"
						disabled={restarting}
						onClick={() => reconnectRef.current?.()}
						className={OVERLAY_BUTTON_CLASS}
					>
						Reconnect
					</button>
				</div>
			)}
		</div>
	);
}
