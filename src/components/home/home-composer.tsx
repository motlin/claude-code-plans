import {useQuery} from "@tanstack/react-query";
import {useNavigate} from "@tanstack/react-router";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {HOME_DOCK_CLASS} from "../dock-tokens";

import {useActiveSessionsIfAvailable} from "../../hooks/use-claude-events";
import {useIdlePrefetch} from "../../hooks/use-idle-prefetch";
import {useSlashCommands} from "../../hooks/use-slash-commands";
import {promptHistoryQueryOptions} from "../../lib/api/prompt-history";
import {composerDefaultsQueryOptions, composerFolderDefaultsQueryOptions} from "../../lib/api/composer-defaults";
import {homeFolderStatusQueryOptions} from "../../lib/api/home-folder-status";
import {HerdrRequestError, isNoTerminalHost, launchHerdrSession} from "../../lib/api/herdr";
import {getComposerText, refillRejectedSend, restoreRejectedAttachments} from "../../lib/context-attach";
import {restoreStoredDraft} from "../../hooks/use-composer-draft";
import {startFailedOffscreenToast, type StartFailure} from "../../lib/send-rejection";
import {buildClaudeCopyCommand} from "../../lib/claude-launch-command";
import {writeClipboardText} from "../../lib/clipboard";
import {usageQueryOptions} from "../../lib/api/usage";
import {resolveComposerState, withComposerAccountLimits} from "../../lib/composer-state";
import {buildLaunchFlags, type LaunchOptions, modeMenuItems} from "../../lib/launch-options";
import {useFolderModeMemory} from "../../hooks/use-folder-mode-memory";
import {draftPermissionMode} from "../../lib/folder-permission-mode";
import {
	onHomeComposerFocusRequest,
	onHomeComposerPrefillRequest,
	requestHomeComposerPrefill,
} from "../../lib/home-composer-focus";
import {findLaunchedSession, type PendingLaunch} from "../../lib/palette-start-session";
import {assignLaunchedSession, setPendingLaunchGroup} from "../../lib/session-group-store";
import {Composer} from "../composer";
import {LazySendRejectedCard} from "../lazy-send-rejected-card";
import {loadSendRejectedCard} from "../send-rejected-card-loader";
import {useSendRejectionActions} from "../use-send-rejection-actions";
import {useToast} from "../toast-context";
import {UsagePaceBanner} from "../usage-pace-banner";
import {useHomeLaunchFolder, useHomeWorktree} from "./launch-folder";
import {ProjectPicker} from "./project-picker";

export {HOME_RECENT_LIMIT} from "./launch-folder";

/** The failed-start card is cached by the time a launch can fail: warmed at idle and again when a launch starts. */
const HOME_DOCK_CHUNKS = [loadSendRejectedCard];

/**
 * The docked claude.ai/code home composer: the prompt card over an environment
 * bar that leads with the project folder picker. Sending starts `claude` in a new herdr tab in the chosen project and
 * opens the session once its SessionStart arrives; without herdr it copies the
 * equivalent shell command instead. A `prefill` replaces the draft once on mount (nothing is sent), then
 * `onPrefillApplied` lets the caller drop whatever asked for it.
 */
export function HomeComposer({
	prefill,
	onPrefillApplied,
}: Readonly<{prefill?: string | undefined; onPrefillApplied?: (() => void) | undefined}> = {}) {
	const navigate = useNavigate();
	const toast = useToast();
	const activeSessions = useActiveSessionsIfAvailable();
	const {data: defaults} = useQuery(composerDefaultsQueryOptions);
	useIdlePrefetch(HOME_DOCK_CHUNKS);
	const [pendingLaunch, setPendingLaunch] = useState<(PendingLaunch & {worktree: boolean}) | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	// Upstream keeps the failed start's display error in memory only: a reload or remount drops the card.
	const [startFailure, setStartFailure] = useState<StartFailure | null>(null);
	const mountedRef = useRef(true);
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);
	const rejection = useMemo(
		() =>
			startFailure === null
				? null
				: {prompt: startFailure.restoredDraft, message: startFailure.message, nonResendable: false},
		[startFailure],
	);
	const clearStartFailure = useCallback(() => {
		setStartFailure(null);
	}, []);
	const {retryRejection, dismissRejection} = useSendRejectionActions("home", rejection, clearStartFailure);

	const {
		projects: startProjects,
		selected: project,
		select: setChosenProjectId,
		launching,
		setLaunching,
	} = useHomeLaunchFolder();
	const {data: folderStatus} = useQuery(homeFolderStatusQueryOptions(project?.projectPath));
	const worktree = useHomeWorktree(folderStatus?.isGitRepo);
	const folderModes = useFolderModeMemory(project?.projectPath);
	const {data: folderDefaults} = useQuery(composerFolderDefaultsQueryOptions(project?.projectPath));
	const bypassPermissionsAllowed = defaults?.bypassPermissionsAllowed ?? false;
	const draftMode = useMemo(
		() =>
			draftPermissionMode({
				cwd: project?.projectPath,
				modes: folderModes.modes,
				userSettingsDefault: defaults?.defaultMode ?? null,
				repoSettingsDefault: folderDefaults?.repoDefaultMode ?? null,
				available: modeMenuItems(bypassPermissionsAllowed).map((item) => item.id),
			}),
		[
			project?.projectPath,
			folderModes.modes,
			defaults?.defaultMode,
			folderDefaults?.repoDefaultMode,
			bypassPermissionsAllowed,
		],
	);
	const slashMenu = useSlashCommands(project?.projectPath ?? undefined);
	const {data: promptHistory} = useQuery(promptHistoryQueryOptions(undefined));

	// The home bar has no statusline, so its ring reads the account's plan limits.
	const {data: accountUsage} = useQuery(usageQueryOptions);
	const chin = useMemo(
		() =>
			defaults === undefined
				? undefined
				: withComposerAccountLimits(
						resolveComposerState({
							hookPermissionMode: null,
							jsonlPermissionMode: null,
							settingsDefaultMode: draftMode.mode,
							statuslineModel: null,
							statuslineModelId: null,
							lastAssistantModel: null,
							lastAssistantUsage: null,
							lastAssistantEffort: null,
							fastMode: defaults.fastMode,
							fastModeBlocked: defaults.fastModeBlocked,
							settingsModel: defaults.model,
							settingsEffortLevel: defaults.effortLevel,
							statusline: null,
							statuslineUpdatedAt: null,
						}),
						accountUsage,
					),
		[defaults, accountUsage, draftMode.mode],
	);

	useEffect(
		() =>
			onHomeComposerFocusRequest(() => {
				rootRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
			}),
		[],
	);

	// Runs after the Composer's own mount effects, so the prefill wins over the restored draft.
	useEffect(() => {
		if (prefill === undefined) return;
		requestHomeComposerPrefill(prefill);
		onPrefillApplied?.();
	}, [prefill, onPrefillApplied]);

	// The launched session opens once its SessionStart hook arrives over SSE.
	useEffect(() => {
		if (pendingLaunch === null) return;
		const id = findLaunchedSession(activeSessions.values(), pendingLaunch);
		if (id === null) return;
		setPendingLaunch(null);
		assignLaunchedSession(id);
		void navigate({to: "/session/$id", params: {id}});
	}, [pendingLaunch, activeSessions, navigate]);

	/**
	 * Upstream's failed-start restore: the prompt and its tiles go back into the composer under the
	 * start-failed card, or, when home has unmounted, into the stored draft with a toast.
	 */
	function restoreFailedStart(prompt: string, error: unknown) {
		if (!mountedRef.current) {
			restoreStoredDraft("home", restoreRejectedAttachments("home", prompt) ?? prompt);
			toast({kind: "error", message: startFailedOffscreenToast({promptIsBack: prompt.trim() !== ""})});
			return;
		}
		refillRejectedSend("home", prompt);
		const message = error instanceof Error && error.message !== "" ? error.message : "Send failed";
		setStartFailure({message, restoredDraft: getComposerText("home") ?? prompt});
	}

	/** `stay` (⌘⏎) launches without opening the session, leaving home ready for the next prompt. */
	async function launch(prompt: string, launchOptions: LaunchOptions, stay = false) {
		if (project === undefined) {
			toast({kind: "error", message: "Choose a project to start a session in."});
			return;
		}
		// The remembered mode goes on the command line only when the CLI wouldn't start in it by itself.
		const withMode =
			launchOptions.permissionMode === undefined && draftMode.launchFlag !== undefined
				? {...launchOptions, permissionMode: draftMode.launchFlag}
				: launchOptions;
		const args = buildLaunchFlags(worktree.useWorktree ? {...withMode, worktree: true} : withMode);
		const request = {cwd: project.projectPath, prompt, ...(args.length > 0 ? {args} : {})};
		const since = Date.now();
		loadSendRejectedCard().catch(() => {});
		// A new start clears the last failure's card, as upstream does.
		setStartFailure(null);
		setLaunching(true);
		try {
			const {sessionId} = await launchHerdrSession(request);
			// The launch ends this draft, so its Worktree override goes back to the preference.
			worktree.endDraft();
			if (stay) {
				if (sessionId === null) setPendingLaunchGroup(null);
				else assignLaunchedSession(sessionId);
				toast({kind: "success", message: `Started a session in ${project.name}`});
			} else {
				setPendingLaunch({cwd: request.cwd, since, sessionId, worktree: worktree.useWorktree});
			}
		} catch (error) {
			// Without a terminal host the shell command is the way to start; a copy that fails falls back to the card.
			if (isNoTerminalHost(error) && (await writeClipboardText(buildClaudeCopyCommand(request)))) {
				toast({kind: "success", message: "Copied command — no terminal to launch in"});
				return;
			}
			restoreFailedStart(prompt, error);
			// claude started before its prompt failed: open its session once it shows up, as upstream keeps a created session.
			if (
				mountedRef.current &&
				error instanceof HerdrRequestError &&
				error.code === "agent_prompt_failed" &&
				error.sessionId !== undefined
			) {
				setPendingLaunch({cwd: request.cwd, since, sessionId: error.sessionId, worktree: worktree.useWorktree});
			}
		} finally {
			setLaunching(false);
		}
	}

	return (
		<div ref={rootRef} data-home-composer className={HOME_DOCK_CLASS}>
			{/* Upstream's home sets the weekly pace banner above the composer */}
			<div className="pb-1.5 empty:hidden">
				<UsagePaceBanner />
				{rejection !== null && (
					<LazySendRejectedCard
						rejection={rejection}
						onRetry={retryRejection}
						onDismiss={dismissRejection}
						data={{"data-start-failed": ""}}
					/>
				)}
			</div>
			<Composer
				variant="home"
				draftKey="home"
				onSend={(prompt, launchOptions) => void launch(prompt, launchOptions)}
				onSendAndStay={(prompt, launchOptions) => void launch(prompt, launchOptions, true)}
				disabled={launching}
				deliveryHint={
					pendingLaunch === null
						? undefined
						: pendingLaunch.worktree
							? "Creating worktree…"
							: `Starting session in ${pendingLaunch.cwd}…`
				}
				chin={chin}
				environment={
					<ProjectPicker
						projects={startProjects}
						selected={project}
						onSelect={setChosenProjectId}
						worktree={worktree}
					/>
				}
				{...slashMenu}
				promptHistory={promptHistory?.prompts}
				subscribePrefill={onHomeComposerPrefillRequest}
				bypassPermissionsAllowed={bypassPermissionsAllowed}
				permissionCwd={project?.projectPath}
				onPermissionModePick={folderModes.remember}
			/>
		</div>
	);
}
