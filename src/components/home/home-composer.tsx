import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, Folder } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useActiveSessionsIfAvailable } from "../../hooks/use-claude-events";
import { composerDefaultsQueryOptions } from "../../lib/api/composer-defaults";
import { launchHerdrSession } from "../../lib/api/herdr";
import { projectsQueryOptions } from "../../lib/api/projects";
import { recentSessionsQueryOptions } from "../../lib/api/sessions";
import { buildClaudeCopyCommand } from "../../lib/claude-launch-command";
import { writeClipboardText } from "../../lib/clipboard";
import { resolveComposerState } from "../../lib/composer-state";
import { onHomeComposerFocusRequest } from "../../lib/home-composer-focus";
import {
  findLaunchedSession,
  startSessionProjects,
  type PendingLaunch,
} from "../../lib/palette-start-session";
import { Composer } from "../composer";
import { useToast } from "../toast";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";

/** Same recents page the ⌘K palette reads, so both share one cached query. */
export const HOME_RECENT_LIMIT = 25;

const CHIP_CLASS =
  "flex h-6 max-w-[240px] min-w-0 items-center gap-1 rounded-r6 bg-surface-3 px-1.5 text-[13px] text-secondary shadow-[inset_0_0_0_1px_var(--color-alpha-1),0_1px_2px_rgba(0,0,0,0.05)] transition-colors hover:text-primary focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none";

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
  const { data: projects } = useQuery(projectsQueryOptions());
  const { data: recents } = useQuery(recentSessionsQueryOptions(HOME_RECENT_LIMIT));
  const { data: defaults } = useQuery(composerDefaultsQueryOptions);
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

  const chin = useMemo(
    () =>
      defaults === undefined
        ? undefined
        : resolveComposerState({
            hookPermissionMode: null,
            jsonlPermissionMode: null,
            settingsDefaultMode: defaults.defaultMode,
            statuslineModel: null,
            lastAssistantModel: defaults.model,
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
    void navigate({ to: "/session/$id", params: { id } });
  }, [pendingLaunch, activeSessions, navigate]);

  async function launch(prompt: string) {
    if (project === undefined) {
      toast({ kind: "error", message: "Choose a project to start a session in." });
      return;
    }
    const request = { cwd: project.projectPath, prompt };
    const since = Date.now();
    setLaunching(true);
    try {
      const { sessionId } = await launchHerdrSession(request);
      setPendingLaunch({ cwd: request.cwd, since, sessionId });
    } catch {
      const copied = await writeClipboardText(buildClaudeCopyCommand(request));
      toast(
        copied
          ? { kind: "success", message: "Copied command — herdr unavailable" }
          : { kind: "error", message: "Couldn’t start a session. Try again." },
      );
    } finally {
      setLaunching(false);
    }
  }

  return (
    <div ref={rootRef} data-home-composer className="pb-6">
      <div className="flex flex-wrap gap-1 pr-24 pb-1">
        <Menu>
          <MenuTrigger aria-label="Select project" className={CHIP_CLASS}>
            <Folder aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{project?.name ?? "Select project…"}</span>
            <ChevronDown aria-hidden="true" className="size-3 shrink-0" />
          </MenuTrigger>
          <MenuContent side="top">
            <MenuRadioGroup
              value={project?.id ?? ""}
              onValueChange={(value: string) => setChosenProjectId(value)}
            >
              {startProjects.map((p) => (
                <MenuRadioItem key={p.id} value={p.id} closeOnClick>
                  {p.name}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
      </div>
      <Composer
        variant="home"
        draftKey="home"
        onSend={(prompt) => void launch(prompt)}
        disabled={launching}
        deliveryHint={
          pendingLaunch === null ? undefined : `Starting session in ${pendingLaunch.cwd}…`
        }
        chin={chin}
      />
    </div>
  );
}
