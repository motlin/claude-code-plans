import {useQueryClient} from "@tanstack/react-query";
import {useNavigate} from "@tanstack/react-router";
import {openSessionInFinder} from "../lib/api/sessions";
import {assertNever} from "../lib/assert-never";
import {useSessionArchive} from "../hooks/use-session-archive";
import {useSessionFork} from "../hooks/use-session-fork";
import {type SessionMenuItemId} from "../lib/session-menu-items";
import {
	claudeAiSessionUrl,
	copySessionLink,
	copySessionResumeCommand,
	openPullRequest,
	vscodeFolderUrl,
} from "../lib/session-open-in";
import {transcriptModeLabels} from "../lib/schema-choices";
import {
	loadTranscriptViewNudge,
	recordTranscriptViewPick,
	saveTranscriptViewNudge,
	type TranscriptMode,
	TranscriptModeSchema,
} from "../lib/transcript-mode";
import {assign} from "../lib/session-group-store";
import {markSeen, markUnseen} from "../lib/unread-store";
import {useToast} from "./toast-context";
import type {TranscriptViewActions} from "./session-actions-menu";

/** Runs one session menu item; shared by the row menu and the titlebar chevron menu. */
export function useSessionMenuRunner({
	sessionId,
	cwd,
	bridgeSessionId,
	prUrl,
	requestRename,
	setPinned,
	movePinned,
	requestNewGroup,
	transcriptView,
}: SessionMenuRunnerOptions): SessionMenuRun {
	const queryClient = useQueryClient();
	const toast = useToast();
	const transcriptViewRunner = useTranscriptViewRunner(sessionId, transcriptView);
	const setArchived = useSessionArchive(sessionId);
	const navigate = useNavigate();
	const fork = useSessionFork();

	const revealInFinder = () => {
		openSessionInFinder(sessionId).catch(() => {
			toast({kind: "error", message: "Couldn’t open the folder in Finder."});
		});
	};

	return (id, value): void => {
		switch (id) {
			case "open-live-terminal":
				void navigate({
					to: "/session/$id",
					params: {id: sessionId},
					search: {pane: "terminal"},
				});
				return;
			case "open-terminal":
				if (cwd !== null) void copySessionResumeCommand(sessionId, cwd, toast);
				return;
			case "open-vscode":
				if (cwd !== null) window.open(vscodeFolderUrl(cwd), "_self");
				return;
			case "open-finder":
				revealInFinder();
				return;
			case "open-claude-ai":
				if (bridgeSessionId !== null) {
					window.open(claudeAiSessionUrl(bridgeSessionId), "_blank", "noopener,noreferrer");
				}
				return;
			case "open-pr":
				if (prUrl !== null) openPullRequest(prUrl);
				return;
			case "move-up":
			case "move-down":
				movePinned?.(id === "move-up" ? -1 : 1);
				return;
			case "pin":
			case "unpin":
				setPinned?.(id === "pin");
				return;
			case "mark-read":
			case "mark-completed":
				markSeen(sessionId);
				return;
			case "mark-unread":
				markUnseen(sessionId);
				return;
			case "copy-link":
				void copySessionLink(sessionId, toast, queryClient);
				return;
			case "rename":
				requestRename();
				return;
			case "archive":
			case "unarchive":
				setArchived(id === "archive");
				return;
			case "fork":
				if (cwd !== null) fork({sessionId, cwd});
				return;
			case "move-to-custom-group":
				if (value !== undefined) assign(sessionId, value);
				return;
			case "ungroup":
				assign(sessionId, null);
				return;
			case "new-group":
				requestNewGroup?.();
				return;
			case "transcript-mode":
				transcriptViewRunner.pick(value);
				return;
			case "make-default-transcript-mode":
				transcriptViewRunner.makeCurrentDefault();
				return;
			case "open-in":
			case "move-to-group":
			case "transcript-view":
				return;
			default:
				assertNever(id);
		}
	};
}

export interface SessionMenuRunnerOptions {
	sessionId: string;
	cwd: string | null;
	bridgeSessionId: string | null;
	prUrl: string | null;
	/** Opens the inline rename input once the menu has finished closing. */
	requestRename: () => void;
	/** Pin/Unpin; surfaces without the pin item leave it out. */
	setPinned?: (pinned: boolean) => void;
	/** Move up / Move down within the sidebar Pinned section. */
	movePinned?: (delta: -1 | 1) => void;
	/** Opens the New group dialog for Move to group ▸ New group…. */
	requestNewGroup?: () => void;
	/** The session's transcript view, for the header's Transcript view submenu. */
	transcriptView?: TranscriptViewActions;
}

/** Runs a menu item; radios also pass their value (a Move to group target or a transcript mode). */
export type SessionMenuRun = (id: SessionMenuItemId, value?: string) => void;

/** Transcript view ▸ radios and Make default, with upstream's toasts and default-view nudge. */
function useTranscriptViewRunner(sessionId: string, view: TranscriptViewActions | undefined) {
	const toast = useToast();
	const makeDefault = (mode: TranscriptMode) => {
		view?.makeDefault(mode);
		toast({kind: "success", message: `${transcriptModeLabels[mode]} is now the default view.`});
	};
	const pick = (value: string | undefined) => {
		const parsed = TranscriptModeSchema.safeParse(value);
		if (view === undefined || !parsed.success || parsed.data === view.mode) return;
		const mode = parsed.data;
		view.setMode(mode);
		const {state, due} = recordTranscriptViewPick(loadTranscriptViewNudge(), {
			sessionId,
			mode,
			defaultMode: view.defaultMode,
		});
		saveTranscriptViewNudge(state);
		if (!due) return;
		const label = transcriptModeLabels[mode];
		toast({
			kind: "success",
			message: `Make ${label} your default view?`,
			description: `You’ve picked ${label} in more than one session. You can change the default anytime in Settings.`,
			action: {
				label: "Make default",
				onAction: () => {
					makeDefault(mode);
				},
			},
		});
	};
	const makeCurrentDefault = () => {
		if (view !== undefined) makeDefault(view.mode);
	};
	return {pick, makeCurrentDefault};
}
