/**
 * CLI 2.1.305 elicitation dialogs captured from a private pty (pyte, 100×40) in
 * the herdr-elicitation-dialog-keymap spike: .llm/upstream-sync/dumps/
 * herdr-elicitation-dialog-keymap-screens.txt, with trailing spaces trimmed.
 */

/** The verdict form as it opens: field 0 focused, enum collapsed. */
export const VERDICT_FIELD_FOCUSED = `
 ▐▛███▛█   Claude Code v2.1.305
▝▜██████▀  Opus 5.5 · Claude Max
 ▝▝   ▝▝   /…/10e1d0ca-19a8-4418-990a-f66008edde61/scratchpad/spike · /rc


























────────────────────────────────────────────────────────────────────────────────────────────────────
  MCP server “spike-elicit” requests your input

  Allow spike-tool to run? (verdict-allow)

  ❯ * verdict: ▸ not set

    Accept    Decline

  Esc to cancel · ↑/↓ to navigate · Backspace to unset · → to expand
`;

/** After `right`: the verdict enum expanded into its radio list. */
export const VERDICT_EXPANDED = `
 ▐▛███▛█   Claude Code v2.1.305
▝▜██████▀  Opus 5.5 · Claude Max
 ▝▝   ▝▝   /…/10e1d0ca-19a8-4418-990a-f66008edde61/scratchpad/spike · /rc























────────────────────────────────────────────────────────────────────────────────────────────────────
  MCP server “spike-elicit” requests your input

  Allow spike-tool to run? (verdict-allow)

  ❯ * verdict: ▾
        ❯ ◯ allow
          ◯ deny
          ◯ always_allow

    Accept    Decline

  Esc to cancel · ↑/↓ to navigate · Backspace to unset · Space to select
`;

/** After picking `allow` with `enter`: the field set and focus on Accept. */
export const VERDICT_PICKED = `
 ▐▛███▛█   Claude Code v2.1.305
▝▜██████▀  Opus 5.5 · Claude Max
 ▝▝   ▝▝   /…/10e1d0ca-19a8-4418-990a-f66008edde61/scratchpad/spike · /rc


























────────────────────────────────────────────────────────────────────────────────────────────────────
  MCP server “spike-elicit” requests your input

  Allow spike-tool to run? (verdict-allow)

    ✔ verdict: allow

  ❯ Accept    Decline

  Esc to cancel · ↑/↓ to navigate
`;

/** Two `down`s from the field: focus on the Decline stop. */
export const VERDICT_DECLINE_FOCUSED = `
 ▐▛███▛█   Claude Code v2.1.305
▝▜██████▀  Opus 5.5 · Claude Max
 ▝▝   ▝▝   /…/10e1d0ca-19a8-4418-990a-f66008edde61/scratchpad/spike · /rc


























────────────────────────────────────────────────────────────────────────────────────────────────────
  MCP server “spike-elicit” requests your input

  Allow spike-tool to run? (verdict-decline-row)

    * verdict: not set

    Accept  ❯ Decline

  Esc to cancel · ↑/↓ to navigate
`;

/** Enter on Accept with the verdict unset: the required error, focus back on the field. */
export const VERDICT_REQUIRED_ERROR = `
 ▐▛███▛█   Claude Code v2.1.305
▝▜██████▀  Opus 5.5 · Claude Max
 ▝▝   ▝▝   /…/10e1d0ca-19a8-4418-990a-f66008edde61/scratchpad/spike · /rc


























────────────────────────────────────────────────────────────────────────────────────────────────────
  MCP server “spike-elicit” requests your input

  Allow spike-tool to run? (verdict-accept-unset)

  ❯ ⚠ verdict: ▸ not set
        This field is required
    Accept    Decline

  Esc to cancel · ↑/↓ to navigate · Backspace to unset · → to expand
`;

/** A form with no properties: focus starts on Accept. */
export const EMPTY_SCHEMA = `
 ▐▛███▛█   Claude Code v2.1.305
▝▜██████▀  Opus 5.5 · Claude Max
 ▝▝   ▝▝   /…/10e1d0ca-19a8-4418-990a-f66008edde61/scratchpad/spike · /rc




























────────────────────────────────────────────────────────────────────────────────────────────────────
  MCP server “spike-elicit” requests your input

  Just confirm (empty-schema)

  ❯ Accept    Decline

  Esc to cancel · ↑/↓ to navigate
`;

/** The URL dialog as it opens: focus on Accept. */
export const URL_ACCEPT_FOCUSED = `
 ▐▛███▛█   Claude Code v2.1.305
▝▜██████▀  Opus 5.5 · Claude Max
 ▝▝   ▝▝   /…/10e1d0ca-19a8-4418-990a-f66008edde61/scratchpad/spike · /rc


























────────────────────────────────────────────────────────────────────────────────────────────────────
  MCP server “spike-elicit” wants to open a URL

  Open the spike page (url-decline)

  https://example.com/spike

  ❯ Accept    Decline

  Esc to cancel · ←/→ to switch
`;

/** The URL dialog after `right`: focus on Decline. */
export const URL_DECLINE_FOCUSED = `
 ▐▛███▛█   Claude Code v2.1.305
▝▜██████▀  Opus 5.5 · Claude Max
 ▝▝   ▝▝   /…/10e1d0ca-19a8-4418-990a-f66008edde61/scratchpad/spike · /rc


























────────────────────────────────────────────────────────────────────────────────────────────────────
  MCP server “spike-elicit” wants to open a URL

  Open the spike page (url-decline)

  https://example.com/spike

    Accept  ❯ Decline

  Esc to cancel · ←/→ to switch
`;
