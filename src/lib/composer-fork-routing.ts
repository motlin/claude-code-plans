import type { ToastOptions } from "../components/toast";
import { buildLaunchFlags, type LaunchOptions } from "./launch-options";
import { type PendingFork, sessionForkArgs } from "./session-fork";

/** The session's herdr pane: working on a turn, idle at its prompt, or absent. */
export type ComposerPaneState = "working" | "idle" | "none";
/** Enter sends; ⌥⌘⏎ "Fork with this prompt". */
export type ComposerSubmit = "send" | "fork";
export type ComposerRoute = "herdr-prompt" | "fork-stream" | "herdr-launch";

interface RouteInput {
  pane: ComposerPaneState;
  writesEnabled: boolean;
  submit: ComposerSubmit;
}

/**
 * Where a composer submit goes. A writable live pane takes Enter (queued while
 * it works) and launches ⌥⌘⏎ as a new herdr fork; everything else runs the
 * headless `/api/chat` fork stream, which is also what Enter does without a pane.
 */
export function routeComposerSubmit({ pane, writesEnabled, submit }: RouteInput): ComposerRoute {
  if (pane === "none" || !writesEnabled) return "fork-stream";
  return submit === "send" ? "herdr-prompt" : "herdr-launch";
}

/** `claude --resume <id> --fork-session` plus the chin's launch flags, as an argv array. */
export function promptForkArgs(sessionId: string, launchOptions: LaunchOptions): string[] {
  return [...sessionForkArgs(sessionId), ...buildLaunchFlags(launchOptions)];
}

/** Upstream names the headless fork "Send in a forked session"; a herdr fork is "Fork with this prompt". */
export function forkSubmitLabel({
  pane,
  writesEnabled,
}: Omit<RouteInput, "submit">): "Fork with this prompt" | "Send in a forked session" {
  return pane !== "none" && !writesEnabled ? "Send in a forked session" : "Fork with this prompt";
}

export interface ComposerSubmitContext extends RouteInput {
  sessionId: string;
  cwd: string;
  prompt: string;
  launchOptions: LaunchOptions;
}

export interface ComposerSubmitTargets {
  sendLive: (prompt: string) => void;
  sendForkStream: (prompt: string, launchOptions: LaunchOptions) => void;
  launchFork: (launch: PromptForkLaunch) => void;
}

export function dispatchComposerSubmit(
  context: ComposerSubmitContext,
  { sendLive, sendForkStream, launchFork }: ComposerSubmitTargets,
): ComposerRoute {
  const route = routeComposerSubmit(context);
  switch (route) {
    case "herdr-prompt":
      sendLive(context.prompt);
      break;
    case "fork-stream":
      sendForkStream(context.prompt, context.launchOptions);
      break;
    case "herdr-launch":
      launchFork({
        cwd: context.cwd,
        prompt: context.prompt,
        args: promptForkArgs(context.sessionId, context.launchOptions),
      });
      break;
  }
  return route;
}

export interface PromptForkLaunch {
  cwd: string;
  prompt: string;
  args: string[];
}

export interface LaunchPromptForkDependencies {
  launch: (launch: PromptForkLaunch) => Promise<{ sessionId: string | null }>;
  /** Hands the fork to the navigator, which opens it once its SessionStart arrives. */
  onLaunched: (pending: PendingFork) => void;
  toast: (options: ToastOptions) => void;
  now: () => number;
}

/** Start the ⌥⌘⏎ fork in a new herdr tab; false (after an error toast) when herdr cannot. */
export async function launchPromptFork(
  launch: PromptForkLaunch,
  parentSessionId: string,
  { launch: launcher, onLaunched, toast, now }: LaunchPromptForkDependencies,
): Promise<boolean> {
  const since = now();
  try {
    const { sessionId } = await launcher(launch);
    onLaunched({ cwd: launch.cwd, since, sessionId, parentSessionId });
    return true;
  } catch (error) {
    toast({
      kind: "error",
      message: "Couldn’t fork the session. Try again.",
      description: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
