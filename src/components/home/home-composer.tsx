import {useQuery} from "@tanstack/react-query";
import {useNavigate} from "@tanstack/react-router";
import {useEffect, useMemo, useRef, useState} from "react";

import {useActiveSessionsIfAvailable} from "../../hooks/use-claude-events";
import {slashCommandsQueryOptions} from "../../lib/api/commands";
import {promptHistoryQueryOptions} from "../../lib/api/prompt-history";
import {composerDefaultsQueryOptions} from "../../lib/api/composer-defaults";
import {launchHerdrSession} from "../../lib/api/herdr";
import {projectsQueryOptions} from "../../lib/api/projects";
import {recentSessionsQueryOptions} from "../../lib/api/sessions";
import {buildClaudeCopyCommand} from "../../lib/claude-launch-command";
import {writeClipboardText} from "../../lib/clipboard";
import {resolveComposerState} from "../../lib/composer-state";
import {buildLaunchFlags, type LaunchOptions} from "../../lib/launch-options";
import {onHomeComposerFocusRequest} from "../../lib/home-composer-focus";
import {findLaunchedSession, startSessionProjects, type PendingLaunch} from "../../lib/palette-start-session";
import {Composer} from "../composer";
import {useToast} from "../toast";
import {ClawdMascot} from "./clawd-mascot";
import {ProjectPicker} from "./project-picker";

/** Same recents page the ⌘K palette reads, so both share one cached query. */
export const HOME_RECENT_LIMIT = 25;

/**
 * The docked claude.ai/code home composer: a project chip row above the prompt
 * card. Sending starts `claude` in a new herdr tab in the chosen project and
 * opens the session once its SessionStart arrives; without herdr it copies the
 * equivalent shell command instead.
 */
export function HomeComposer() {
	const navigate = useNavigate();
	const toast = useToast();
	const activeSessions = useActiveSessionsIfAvailable();
	const {data: projects} = useQuery(projectsQueryOptions());
	const {data: recents} = useQuery(recentSessionsQueryOptions(HOME_RECENT_LIMIT));
	const {data: defaults} = useQuery(composerDefaultsQueryOptions);
	const [chosenProjectId, setChosenProjectId] = useState<string | null>(null);
	const [launching, setLaunching] = useState(false);
	const [pendingLaunch, setPendingLaunch] = useState<PendingLaunch | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);

	const startProjects = useMemo(
		() =>
			startSessionProjects(
				projects ?? [],
				(recents?.sessions ?? []).map((session) => session.project),
				undefined,
			),
		[projects, recents],
	);
	const project = startProjects.find((p) => p.id === chosenProjectId) ?? startProjects[0];
	const {data: slashCommands} = useQuery(slashCommandsQueryOptions(project?.projectPath ?? undefined));
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
		void navigate({to: "/session/$id", params: {id}});
	}, [pendingLaunch, activeSessions, navigate]);

	/** `stay` (⌘⏎) launches without opening the session, leaving home ready for the next prompt. */
	async function launch(prompt: string, launchOptions: LaunchOptions, stay = false) {
		if (project === undefined) {
			toast({kind: "error", message: "Choose a project to start a session in."});
			return;
		}
		const args = buildLaunchFlags(launchOptions);
		const request = {cwd: project.projectPath, prompt, ...(args.length > 0 ? {args} : {})};
		const since = Date.now();
		setLaunching(true);
		try {
			const {sessionId} = await launchHerdrSession(request);
			if (stay) {
				toast({kind: "success", message: `Started a session in ${project.name}`});
			} else {
				setPendingLaunch({cwd: request.cwd, since, sessionId});
			}
		} catch {
			const copied = await writeClipboardText(buildClaudeCopyCommand(request));
			toast(
				copied
					? {kind: "success", message: "Copied command — herdr unavailable"}
					: {kind: "error", message: "Couldn’t start a session. Try again."},
			);
		} finally {
			setLaunching(false);
		}
	}

	return (
		<div ref={rootRef} data-home-composer className="pb-[var(--home-dock-bottom,24px)]">
			<div className="flex flex-wrap gap-1 pr-24 pb-1">
				<ProjectPicker projects={startProjects} selected={project} onSelect={setChosenProjectId} />
			</div>
			<ClawdMascot />
			<Composer
				variant="home"
				draftKey="home"
				onSend={(prompt, launchOptions) => void launch(prompt, launchOptions)}
				onSendAndStay={(prompt, launchOptions) => void launch(prompt, launchOptions, true)}
				disabled={launching}
				deliveryHint={pendingLaunch === null ? undefined : `Starting session in ${pendingLaunch.cwd}…`}
				chin={chin}
				slashCommands={slashCommands}
				promptHistory={promptHistory}
				bypassPermissionsAllowed={defaults?.bypassPermissionsAllowed ?? false}
			/>
		</div>
	);
}
