import {useQuery} from "@tanstack/react-query";
import {useNavigate} from "@tanstack/react-router";
import {useEffect, useMemo, useRef, useState} from "react";
import {HOME_DOCK_CLASS} from "../dock-tokens";

import {useActiveSessionsIfAvailable} from "../../hooks/use-claude-events";
import {useSlashCommands} from "../../hooks/use-slash-commands";
import {promptHistoryQueryOptions} from "../../lib/api/prompt-history";
import {composerDefaultsQueryOptions} from "../../lib/api/composer-defaults";
import {homeFolderStatusQueryOptions} from "../../lib/api/home-folder-status";
import {launchHerdrSession} from "../../lib/api/herdr";
import {buildClaudeCopyCommand} from "../../lib/claude-launch-command";
import {writeClipboardText} from "../../lib/clipboard";
import {resolveComposerState} from "../../lib/composer-state";
import {buildLaunchFlags, type LaunchOptions} from "../../lib/launch-options";
import {onHomeComposerFocusRequest, onHomeComposerPrefillRequest} from "../../lib/home-composer-focus";
import {findLaunchedSession, type PendingLaunch} from "../../lib/palette-start-session";
import {assignLaunchedSession, setPendingLaunchGroup} from "../../lib/session-group-store";
import {Composer} from "../composer";
import {useToast} from "../toast-context";
import {ClawdMascot} from "./clawd-mascot";
import {UsagePaceBanner} from "../usage-pace-banner";
import {useHomeLaunchFolder, useHomeWorktree} from "./launch-folder";
import {ProjectPicker} from "./project-picker";

export {HOME_RECENT_LIMIT} from "./launch-folder";

/**
 * The docked claude.ai/code home composer: the prompt card over an environment
 * bar that leads with the project folder picker. Sending starts `claude` in a new herdr tab in the chosen project and
 * opens the session once its SessionStart arrives; without herdr it copies the
 * equivalent shell command instead.
 */
export function HomeComposer() {
	const navigate = useNavigate();
	const toast = useToast();
	const activeSessions = useActiveSessionsIfAvailable();
	const {data: defaults} = useQuery(composerDefaultsQueryOptions);
	const [pendingLaunch, setPendingLaunch] = useState<(PendingLaunch & {worktree: boolean}) | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);

	const {
		projects: startProjects,
		selected: project,
		select: setChosenProjectId,
		launching,
		setLaunching,
	} = useHomeLaunchFolder();
	const {data: folderStatus} = useQuery(homeFolderStatusQueryOptions(project?.projectPath));
	const worktree = useHomeWorktree(folderStatus?.isGitRepo);
	const slashMenu = useSlashCommands(project?.projectPath ?? undefined);
	const {data: promptHistory} = useQuery(promptHistoryQueryOptions(undefined));

	const chin = useMemo(
		() =>
			defaults === undefined
				? undefined
				: resolveComposerState({
						hookPermissionMode: null,
						jsonlPermissionMode: null,
						settingsDefaultMode: defaults.defaultMode,
						statuslineModel: null,
						statuslineModelId: null,
						lastAssistantModel: null,
						lastAssistantUsage: null,
						lastAssistantEffort: null,
						fastMode: defaults.fastMode,
						settingsModel: defaults.model,
						settingsEffortLevel: defaults.effortLevel,
						statusline: null,
						statuslineUpdatedAt: null,
					}),
		[defaults],
	);

	useEffect(
		() =>
			onHomeComposerFocusRequest(() => {
				rootRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
			}),
		[],
	);

	// The launched session opens once its SessionStart hook arrives over SSE.
	useEffect(() => {
		if (pendingLaunch === null) return;
		const id = findLaunchedSession(activeSessions.values(), pendingLaunch);
		if (id === null) return;
		setPendingLaunch(null);
		assignLaunchedSession(id);
		void navigate({to: "/session/$id", params: {id}});
	}, [pendingLaunch, activeSessions, navigate]);

	/** `stay` (⌘⏎) launches without opening the session, leaving home ready for the next prompt. */
	async function launch(prompt: string, launchOptions: LaunchOptions, stay = false) {
		if (project === undefined) {
			toast({kind: "error", message: "Choose a project to start a session in."});
			return;
		}
		const args = buildLaunchFlags(worktree.useWorktree ? {...launchOptions, worktree: true} : launchOptions);
		const request = {cwd: project.projectPath, prompt, ...(args.length > 0 ? {args} : {})};
		const since = Date.now();
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
		} catch {
			const copied = await writeClipboardText(buildClaudeCopyCommand(request));
			toast(
				copied
					? {kind: "success", message: "Copied command — no terminal to launch in"}
					: {kind: "error", message: "Couldn’t start a session. Try again."},
			);
		} finally {
			setLaunching(false);
		}
	}

	return (
		<div ref={rootRef} data-home-composer className={HOME_DOCK_CLASS}>
			{/* Upstream's home sets the weekly pace banner above the composer */}
			<div className="pb-1.5 empty:hidden">
				<UsagePaceBanner />
			</div>
			<ClawdMascot />
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
				promptHistory={promptHistory}
				subscribePrefill={onHomeComposerPrefillRequest}
				bypassPermissionsAllowed={defaults?.bypassPermissionsAllowed ?? false}
			/>
		</div>
	);
}
