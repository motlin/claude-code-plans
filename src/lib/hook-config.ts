/**
 * Generates the Claude Code hooks configuration block for ~/.claude/settings.json.
 *
 * Each hook event fires a curl POST to the local server's /api/hook endpoint,
 * forwarding the full hook stdin payload from Claude Code (tool_input,
 * tool_response, transcript_path, prompt, etc.) merged with a snapshot of all
 * CLAUDE-prefixed environment variables (plus tmux and herdr identity vars) under
 * `claude_env`. The server uses this for real-time session tracking, task completion
 * notifications, SSE broadcasts, and mapping sessions to terminal panes.
 */

import { KNOWN_HOOK_EVENTS } from "./hook-events";

export const DEFAULT_HOOK_PORT = 7526;

/**
 * All Claude hook event names that the server handles. Derived from the
 * `HookEventEnvelope` discriminated union in `hook-events.ts` so there is a
 * single source of truth — adding a new variant to the union automatically
 * adds a hook entry here without a second list to keep in sync.
 */
export const HOOK_EVENT_NAMES = KNOWN_HOOK_EVENTS;

interface HookEntry {
  type: "command";
  command: string;
}

interface HookMatcher {
  matcher?: string;
  hooks: HookEntry[];
}

interface HooksConfig {
  hooks: Record<string, HookMatcher[]>;
}

/**
 * Single jq filter applied to every hook event. Reads the full hook context
 * JSON from stdin (whatever Claude Code chose to send for this event) and
 * merges in a `claude_env` field carrying every CLAUDE-prefixed environment
 * variable plus the tmux `TMUX`/`TMUX_PANE` and herdr identity vars (selected
 * by exact name, used to map a session to its live terminal pane). We do *not*
 * strip any fields — the server-side strict Zod schema decides what's valid and
 * the schema-drift recovery path handles new fields.
 *
 * Exported so the round-trip test in `tests/hook-jq-roundtrip.test.ts` can
 * shell out to the exact same `jq` invocation a real hook would, against a
 * captured stdin payload, and assert the result still parses cleanly under
 * `HookEventEnvelope`.
 */
export const HOOK_PAYLOAD_JQ_FILTER =
  '. + {claude_env: ($ENV | with_entries(select(.key | startswith("CLAUDE") or . == "TMUX" or . == "TMUX_PANE" or . == "HERDR_PANE_ID" or . == "HERDR_WORKSPACE_ID" or . == "HERDR_TAB_ID" or . == "HERDR_SOCKET_PATH" or . == "HERDR_ENV")))}';

function curlPost(port: number): string {
  // --connect-timeout 0.1 + `|| true` guarantee the hook never blocks Claude:
  // if the viewer isn't running the curl returns immediately and the shell
  // exits 0 regardless.
  return `jq -c '${HOOK_PAYLOAD_JQ_FILTER}' | curl -sX POST --connect-timeout 0.1 http://localhost:${port}/api/hook -H 'Content-Type: application/json' --data-binary @- >/dev/null 2>&1 || true`;
}

function curlContextBrief(port: number): string {
  // This response must reach hook stdout because Claude injects it as session
  // context. URL encoding preserves cwd paths containing spaces or punctuation.
  return `curl -s --get --connect-timeout 0.5 --data-urlencode "cwd=$(pwd)" "http://localhost:${port}/api/context-brief" 2>/dev/null || true`;
}

interface GenerateOptions {
  port?: number;
  includeContextBrief?: boolean;
}

export function generateHooksConfig(options?: GenerateOptions): HooksConfig {
  const port = options?.port ?? DEFAULT_HOOK_PORT;
  const hooks: Record<string, HookMatcher[]> = {};
  const command = curlPost(port);

  for (const eventName of HOOK_EVENT_NAMES) {
    hooks[eventName] = [
      {
        hooks: [
          {
            type: "command",
            command,
          },
        ],
      },
    ];
  }

  if (options?.includeContextBrief === true) {
    const sessionStartHooks = hooks["SessionStart"];
    if (!sessionStartHooks) {
      throw new Error("SessionStart must be a known hook event");
    }
    sessionStartHooks.push({
      matcher: "startup|resume",
      hooks: [
        {
          type: "command",
          command: curlContextBrief(port),
        },
      ],
    });
  }

  return { hooks };
}

/**
 * Return a pretty-printed JSON string of just the hooks block,
 * suitable for copying into ~/.claude/settings.json.
 */
export function generateHooksJson(options?: GenerateOptions): string {
  return JSON.stringify(generateHooksConfig(options), null, 2);
}
