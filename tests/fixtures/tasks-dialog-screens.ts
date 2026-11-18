/**
 * Real CLI `/tasks` dialog screens (CLI 2.1.327), captured by background-task-row-stop from a private pty
 * (pyte, 100×40) against a local fake Messages API with an isolated CLAUDE_CONFIG_DIR, as in the
 * permission-dialog-capture-spike: .llm/upstream-sync/dumps/background-task-row-stop-tasks-dialog-screens-2026-11-17.txt.
 * Each is the whole screen; the scratch cwd reads /tmp/spike/cwd.
 */

/** Two background shells (`sleep 300`, then `sleep 301`), no other kinds: no section headings; newest first, the first row selected. */
export const TWO_SHELLS = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd

▎ Auto mode is now Claude Code's default permission mode.
▎ Auto mode lets Claude handle permission prompts automatically. Claude checks each tool call for
▎ risky actions and prompt injection before executing, runs the ones it assesses as lower-risk, and
▎ blocks the rest.
▎ https://code.claude.com/docs/en/permission-modes

❯ SPIKE:bg go

  Ran 2 shell commands

⏺ ok

✻ Cooked for 0s · done 9:27 PM · 2 shells still running












▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  Background
  2 active shells

  ❯ ⏺ sleep 301   running
    ⏺ sleep 300   running

      Earlier in this session (0)

  ↑/↓ to navigate · x to stop · Enter to view · Esc to close
`;

/** TWO_SHELLS after one Down. */
export const TWO_SHELLS_DOWN = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd

▎ Auto mode is now Claude Code's default permission mode.
▎ Auto mode lets Claude handle permission prompts automatically. Claude checks each tool call for
▎ risky actions and prompt injection before executing, runs the ones it assesses as lower-risk, and
▎ blocks the rest.
▎ https://code.claude.com/docs/en/permission-modes

❯ SPIKE:bg go

  Ran 2 shell commands

⏺ ok

✻ Cooked for 0s · done 9:27 PM · 2 shells still running












▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  Background
  2 active shells

    ⏺ sleep 301   running
  ❯ ⏺ sleep 300   running

      Earlier in this session (0)

  ↑/↓ to navigate · x to stop · Enter to view · Esc to close
`;

/** TWO_SHELLS_DOWN after Enter: the detail of `sleep 300` (description "Sleep alpha"). */
export const TWO_SHELLS_DETAIL = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd

▎ Auto mode is now Claude Code's default permission mode.
▎ Auto mode lets Claude handle permission prompts automatically. Claude checks each tool call for
▎ risky actions and prompt injection before executing, runs the ones it assesses as lower-risk, and
▎ blocks the rest.
▎ https://code.claude.com/docs/en/permission-modes

❯ SPIKE:bg go

  Ran 2 shell commands

⏺ ok

✻ Cooked for 0s · done 9:27 PM · 2 shells still running










▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  Sleep alpha
  shell

  Status:   running
  Runtime:  10s
  Command:  sleep 300

  Output
  No output yet

  ← to go back · x to stop · Enter/Space to close · Esc to close
`;

/** Two shells (one command too long for its column, cut with an ellipsis) and a completed agent: section headings Shells / Completed. */
export const TRUNCATED_WITH_COMPLETED = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd


❯ SPIKE:mix go

  Ran 2 shell commands

⏺ Agent(Wait around agent)
  ⎿  Backgrounded agent (↓ to manage · ctrl+o to expand)

⏺ ok

✻ Waiting for 1 background agent to finish

⏺ Agent "Wait around agent" finished · 0s

⏺ ok

✻ Cogitated for 0s · done 9:28 PM · 2 shells still running




▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  Background
  2 active shells

    Shells
  ❯ ⏺ sleep 301 && echo this is a much longer command l…   running
    ⏺ sleep 300                                            running

    Completed
    ✔ Wait around agent                                    done · Opus 5.5

      Earlier in this session (0)

  ↑/↓ to navigate · x to stop · Enter to view · Esc to close
`;

/** TRUNCATED_WITH_COMPLETED after one Down. */
export const TRUNCATED_WITH_COMPLETED_DOWN = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd


❯ SPIKE:mix go

  Ran 2 shell commands

⏺ Agent(Wait around agent)
  ⎿  Backgrounded agent (↓ to manage · ctrl+o to expand)

⏺ ok

✻ Waiting for 1 background agent to finish

⏺ Agent "Wait around agent" finished · 0s

⏺ ok

✻ Cogitated for 0s · done 9:28 PM · 2 shells still running




▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  Background
  2 active shells

    Shells
    ⏺ sleep 301 && echo this is a much longer command l…   running
  ❯ ⏺ sleep 300                                            running

    Completed
    ✔ Wait around agent                                    done · Opus 5.5

      Earlier in this session (0)

  ↑/↓ to navigate · x to stop · Enter to view · Esc to close
`;

/** TRUNCATED_WITH_COMPLETED_DOWN after `x` in the list: the row is gone at once and the selection moves on. */
export const TRUNCATED_WITH_COMPLETED_AFTER_X = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd


❯ SPIKE:mix go

  Ran 2 shell commands

⏺ Agent(Wait around agent)
  ⎿  Backgrounded agent (↓ to manage · ctrl+o to expand)

⏺ ok

✻ Waiting for 1 background agent to finish

⏺ Agent "Wait around agent" finished · 0s

⏺ ok

✻ Cogitated for 0s · done 9:28 PM · 1 shell still running





▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  Background
  1 active shell

    Shells
    ⏺ sleep 301 && echo this is a much longer command l…   running

    Completed
  ❯ ✔ Wait around agent                                    done · Opus 5.5

      Earlier in this session (0)

  ↑/↓ to navigate · Enter to view · Esc to close
`;

/** Two shells with the same command and description, and a running background agent: section headings Shells / Background agents. */
export const MIXED = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd


❯ SPIKE:mix2 go

  Ran 2 shell commands

⏺ Agent(Wait around agent)
  ⎿  Backgrounded agent (↓ to manage · ctrl+o to expand)

⏺ ok

✻ Waiting for 1 background agent to finish










▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  Background
  2 active shells · 1 active agent

    Shells
  ❯ ⏺ sleep 300           running
    ⏺ sleep 300           running

    Background agents
    ⏺ Wait around agent   running · Opus 5.5

      Earlier in this session (0)

  ↑/↓ to navigate · x to stop · Enter to view · Esc to close
`;

/** MIXED after one Down. */
export const MIXED_DOWN = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd


❯ SPIKE:mix2 go

  Ran 2 shell commands

⏺ Agent(Wait around agent)
  ⎿  Backgrounded agent (↓ to manage · ctrl+o to expand)

⏺ ok

✻ Waiting for 1 background agent to finish










▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  Background
  2 active shells · 1 active agent

    Shells
    ⏺ sleep 300           running
  ❯ ⏺ sleep 300           running

    Background agents
    ⏺ Wait around agent   running · Opus 5.5

      Earlier in this session (0)

  ↑/↓ to navigate · x to stop · Enter to view · Esc to close
`;

/** MIXED after two Downs: the agent row selected (its footer adds `f to foreground`). */
export const MIXED_AGENT = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd


❯ SPIKE:mix2 go

  Ran 2 shell commands

⏺ Agent(Wait around agent)
  ⎿  Backgrounded agent (↓ to manage · ctrl+o to expand)

⏺ ok

✻ Waiting for 1 background agent to finish










▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  Background
  2 active shells · 1 active agent

    Shells
    ⏺ sleep 300           running
    ⏺ sleep 300           running

    Background agents
  ❯ ⏺ Wait around agent   running · Opus 5.5

      Earlier in this session (0)

  ↑/↓ to navigate · x to stop · f to foreground · Enter to view · Esc to close
`;

/** MIXED_AGENT after Enter: the agent's detail. */
export const MIXED_AGENT_DETAIL = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd


❯ SPIKE:mix2 go

  Ran 2 shell commands

⏺ Agent(Wait around agent)
  ⎿  Backgrounded agent (↓ to manage · ctrl+o to expand)

⏺ ok

✻ Waiting for 1 background agent to finish













▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  Wait around agent
  general-purpose · 15s · 23 tokens · 1 tool · Opus 5.5

  Progress
  › Bash(python3 -c 'import time; time.sleep(310)')

  Prompt
  SPIKE:fg sub

  ← to go back · x to stop · f to foreground · Enter/Space to close · Esc to close
`;

/** MIXED_DOWN after Enter: a shell's detail. */
export const MIXED_SHELL_DETAIL = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd


❯ SPIKE:mix2 go

  Ran 2 shell commands

⏺ Agent(Wait around agent)
  ⎿  Backgrounded agent (↓ to manage · ctrl+o to expand)

⏺ ok

✻ Waiting for 1 background agent to finish












▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  Sleep same
  shell

  Status:   running
  Runtime:  17s
  Command:  sleep 300

  Output
  No output yet

  ← to go back · x to stop · Enter/Space to close · Esc to close
`;

/** MIXED_SHELL_DETAIL after `x`: back to the list, one shell fewer. */
export const MIXED_AFTER_DETAIL_X = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd


❯ SPIKE:mix2 go

  Ran 2 shell commands

⏺ Agent(Wait around agent)
  ⎿  Backgrounded agent (↓ to manage · ctrl+o to expand)

⏺ ok

✻ Waiting for 1 background agent to finish











▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  Background
  1 active shell · 1 active agent

    Shells
    ⏺ sleep 300           running

    Background agents
  ❯ ⏺ Wait around agent   running · Opus 5.5

      Earlier in this session (0)

  ↑/↓ to navigate · x to stop · f to foreground · Enter to view · Esc to close
`;

/** A Monitor ("Tick watcher", listed by description) and a shell; both count as shells. */
export const MONITOR = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd


❯ SPIKE:one go

  Ran 1 shell command

⏺ ok

✻ Brewed for 0s · done 9:30 PM

❯ SPIKE:mon go

⏺ Monitor(Tick watcher)
  ⎿  Monitor started · task b4gqpea58 · timeout 5m

⏺ ok

✻ Churned for 0s · done 9:30 PM · 1 shell, 1 monitor still running








▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  Background
  2 active shells

  ❯ ⏺ Tick watcher   running
    ⏺ sleep 300      running

      Earlier in this session (0)

  ↑/↓ to navigate · x to stop · Enter to view · Esc to close
`;

/** MONITOR after one Down. */
export const MONITOR_DOWN = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd


❯ SPIKE:one go

  Ran 1 shell command

⏺ ok

✻ Brewed for 0s · done 9:30 PM

❯ SPIKE:mon go

⏺ Monitor(Tick watcher)
  ⎿  Monitor started · task b4gqpea58 · timeout 5m

⏺ ok

✻ Churned for 0s · done 9:30 PM · 1 shell, 1 monitor still running








▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  Background
  2 active shells

    ⏺ Tick watcher   running
  ❯ ⏺ sleep 300      running

      Earlier in this session (0)

  ↑/↓ to navigate · x to stop · Enter to view · Esc to close
`;

/** MONITOR_DOWN after Enter: the shell's detail (description "Sleep alone"). */
export const MONITOR_SHELL_DETAIL = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd


❯ SPIKE:one go

  Ran 1 shell command

⏺ ok

✻ Brewed for 0s · done 9:30 PM

❯ SPIKE:mon go

⏺ Monitor(Tick watcher)
  ⎿  Monitor started · task b4gqpea58 · timeout 5m

⏺ ok

✻ Churned for 0s · done 9:30 PM · 1 shell, 1 monitor still running






▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  Sleep alone
  shell

  Status:   running
  Runtime:  18s
  Command:  sleep 300

  Output
  No output yet

  ← to go back · x to stop · Enter/Space to close · Esc to close
`;

/** MONITOR_SHELL_DETAIL after `x`: the list with only the Monitor left. */
export const MONITOR_AFTER_DETAIL_X = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd


❯ SPIKE:one go

  Ran 1 shell command

⏺ ok

✻ Brewed for 0s · done 9:30 PM

❯ SPIKE:mon go

⏺ Monitor(Tick watcher)
  ⎿  Monitor started · task b4gqpea58 · timeout 5m

⏺ ok

✻ Churned for 0s · done 9:30 PM · 1 monitor still running









▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  Background
  1 active shell

    ⏺ Tick watcher   running

  ❯   Earlier in this session (0)

  ↑/↓ to navigate · Esc to close
`;

/** `/tasks` with nothing running. */
export const EMPTY = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd




























▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ ◐ medium · /effort ▔
  Background

  No tasks currently running

  ❯ Earlier in this session (0)

  Esc to close
`;

/** The idle prompt after Esc closed the dialog. */
export const IDLE_PROMPT = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd
































────────────────────────────────────────────────────────────────────────────────────────────────────
❯
────────────────────────────────────────────────────────────────────────────────────────────────────
  ⏸ manual mode on · ? for shortcuts · ← for agents
`;

/** `/tasks` with one running shell opens straight on its detail. */
export const SINGLE_DETAIL = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd


❯ SPIKE:one go

  Ran 1 shell command

⏺ ok

✻ Baked for 0s · done 9:32 PM · 1 shell still running















▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
  Sleep alone
  shell

  Status:   running
  Runtime:  7s
  Command:  sleep 300

  Output
  No output yet

  ← to go back · x to stop · Enter/Space to close · Esc to close
`;

/** SINGLE_DETAIL after `x`: the dialog closes and the footer's shell count is gone. */
export const SINGLE_AFTER_X = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd


❯ SPIKE:one go

  Ran 1 shell command

⏺ ok

✻ Baked for 0s · done 9:32 PM























────────────────────────────────────────────────────────────────────────────────────────────────────
❯
────────────────────────────────────────────────────────────────────────────────────────────────────
  ⏸ manual mode on · ? for shortcuts
`;

/** `/tasks` typed into the idle prompt (its command menu open), before Enter. */
export const TYPED_TASKS = `
 ▐▛███▛█   Claude Code v2.1.327
▝▜██████▀  Opus 5.5 · API Usage Billing
 ▝▝   ▝▝   /tmp/spike/cwd

▎ Auto mode is now Claude Code's default permission mode.
▎ Auto mode lets Claude handle permission prompts automatically. Claude checks each tool call for
▎ risky actions and prompt injection before executing, runs the ones it assesses as lower-risk, and
▎ blocks the rest.
▎ https://code.claude.com/docs/en/permission-modes

❯ SPIKE:bg go

  Ran 2 shell commands

⏺ ok

✻ Cooked for 0s · done 9:27 PM · 2 shells still running















  ❯ /tasks                      View and manage everything running in the background
    /subtask                    Send a subagent off with your full context; its result comes back
                                here
────────────────────────────────────────────────────────────────────────────────────────────────────
❯ /tasks
────────────────────────────────────────────────────────────────────────────────────────────────────
  ⏵⏵ auto mode on · 2 shells
`;
