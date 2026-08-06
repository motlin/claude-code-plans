# Upstream handover verification

Verified against the implementation of the 2026-08-05 upstream-handover plan. The audit read the
entire plan, inspected behavior and wiring in the final tree, matched every suggested automated test
to its implementation, and ran the repository gate.

## Result

- Indexed plan tasks: **54 complete, 0 deferred, 0 skipped**.
- Section totals: §8 **5/5**, §9 **18/18**, §10 **14/14**, §11 **17/17**.
- Schema version: **19**. The completed work added or changed indexed data for anchored cwd
  resolution, durable viewed state, file-content FTS, and review bundles; the version has been bumped
  accordingly.
- Final audit repair: the §11.4/§11.5 primitives existed, but the active-session UI had not consumed
  them. The active API now carries creation time, activity state, and approval age; the full-page and
  sidebar lists apply urgency or stable-creation ordering and pass warm/hot approval age to the status
  dot. Settings exposes the sort choice.

“Complete” below means the module exists, the described behavior is wired to a consumer, and the
suggested automated test exists (or the item specified only a build/manual check, noted as such).

## §8 — confirmed bugs

| Item                           | Status   | Behavior and wiring evidence                                                                                                               | Test evidence                                                                          |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 8.1 Resume/fork `cd` prefix    | Complete | `src/routes/session.$id.tsx` builds shell-quoted project-aware commands with a null fallback.                                              | `tests/session-commands.test.ts`                                                       |
| 8.2 Clipboard fallback         | Complete | The session-local copy button awaits `writeClipboardText` and only confirms success.                                                       | `tests/session-copy-button.test.tsx`, `tests/clipboard.test.ts`                        |
| 8.3 Re-index moved sessions    | Complete | `src/lib/db/indexer.ts` upserts the project and unconditionally refreshes `filePath` and `projectId`.                                      | `tests/db.test.ts` moved-session location/project case                                 |
| 8.4 Anchored last cwd          | Complete | `encodeProjectPath` lives in `src/lib/memory.ts`; the indexer tracks last-seen and last project-anchored cwd without accumulating records. | `tests/db.test.ts` shell drift, project move, fallback cases; `tests/memory.test.ts`   |
| 8.5 Deleted transcript pruning | Complete | `pruneDeletedSessions` distinguishes moved IDs from deleted IDs, removes dependents/FTS/index rows, and runs only after a complete scan.   | `tests/db.test.ts` deletion, move preservation, dependent cleanup, partial-scan safety |

## §9 — herdr integration

| Item                             | Status   | Behavior and wiring evidence                                                                                                                                         | Test evidence                                                                                                                                        |
| -------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9.1 Hook environment forwarding  | Complete | `HOOK_PAYLOAD_JQ_FILTER` forwards the five herdr identity/socket variables and hook setup exposes reinstall guidance.                                                | `tests/hook-jq-roundtrip.test.ts`, `tests/hook-config.test.ts`                                                                                       |
| 9.2 Active-store herdr placement | Complete | `deriveHerdr` is applied only for fresh environment snapshots; pane, workspace, and socket fields persist on active entries.                                         | `tests/active-session-store.test.ts`                                                                                                                 |
| 9.3 Socket resolver              | Complete | `resolveHerdrSocketPath` implements socket override, XDG/HOME, named-session, and `default` precedence without I/O.                                                  | `tests/herdr-socket-path.test.ts`                                                                                                                    |
| 9.4 One-request client           | Complete | `herdrRequest` opens one connection, newline-frames the request, buffers a complete response line, correlates by connection, and returns discriminated failures.     | `tests/herdr-client.test.ts`                                                                                                                         |
| 9.5 Availability cache           | Complete | `probeHerdr` caches ping-derived version/protocol and normalized unavailability reasons through HMR.                                                                 | `tests/herdr-availability.test.ts`                                                                                                                   |
| 9.6 Drift-tolerant schemas       | Complete | `src/lib/herdr/schema.ts` uses permissive wire objects and open status strings for the selected protocol surface.                                                    | `tests/herdr-schema.test.ts`                                                                                                                         |
| 9.7 Snapshot pane model          | Complete | `getHerdrPanes` normalizes one snapshot and joins by captured pane plus reported Claude session, preserving terminal identity and provenance.                        | `tests/herdr-panes.test.ts`                                                                                                                          |
| 9.8 Read API/query contract      | Complete | `/api/herdr-panes` dynamically loads server code, returns an empty array when absent, and validates the ccp-facing response.                                         | `tests/api-herdr.test.ts`                                                                                                                            |
| 9.9 Fleet page                   | Complete | `src/routes/herdr.tsx` renders linked placements, advisory herdr state, capability labels, and actionable non-error setup guidance.                                  | Route compilation/full gate; API contract in `tests/api-herdr.test.ts` (the plan suggested manual page verification, not a component test).          |
| 9.10 Event bridge                | Complete | One process-wide subscription uses the required dot-name request/snake-case event mapping, snapshot resync, exponential reconnect, HMR disposal, and SSE broadcasts. | `tests/herdr-subscribe.test.ts`                                                                                                                      |
| 9.11 Cross-site guard            | Complete | `rejectCrossSite` checks both headers; every POST/PUT/DELETE route in `src/routes/api` applies it directly or through its handler.                                   | `tests/same-origin-guard.test.ts` and write-route suites                                                                                             |
| 9.12 Prompt route                | Complete | Feature-gated handler re-resolves terminal to current pane, uses `agent.prompt`, and maps protocol errors to HTTP status.                                            | `tests/herdr-prompt.test.ts`                                                                                                                         |
| 9.13 Live chat input             | Complete | Session detail selects live herdr prompt vs existing forked stream, enables the live case, and reports optimistic pending/error state.                               | `tests/session-live-input.test.tsx`                                                                                                                  |
| 9.14 Interrupt route             | Complete | Guarded/flagged handler sends `esc` by default and `ctrl+c` only for explicit force.                                                                                 | `tests/herdr-interrupt.test.ts`                                                                                                                      |
| 9.15 Durable viewed merge        | Complete | SQLite viewed state tracks message index and terminal identity; herdr `done→idle` edges are latched and ORed with browser viewing.                                   | `tests/herdr-viewed-state.test.ts`, `tests/herdr-pane-viewed-state.test.ts`, `tests/viewed-state.test.ts`, `tests/session-viewed-visibility.test.ts` |
| 9.16 Hook state reporting        | Complete | Fire-and-forget reporting uses monotonic sequences, clears on session end, verifies reads, and falls back to metadata on official-session ownership conflict.        | `tests/herdr-report-state.test.ts`, dispatcher coverage                                                                                              |
| 9.17 Shared providers            | Complete | `TerminalPlacementProvider` preserves tmux and herdr capability differences and prefers herdr duplicates in the merged route.                                        | `tests/terminal-placements.test.ts`, `tests/tmux-windows.test.ts`                                                                                    |
| 9.18 Read-only terminal observe  | Complete | Server observer lifecycle parses NDJSON frames; client enforces sequence/keyframe semantics and feeds decoded ANSI to xterm without a control attachment.            | `tests/herdr-terminal-observer.test.ts`, `tests/herdr-terminal-protocol.test.ts`, `tests/herdr-terminal-ui.test.tsx`                                 |

## §10 — viewer features

| Item                       | Status   | Behavior and wiring evidence                                                                                                                                | Test evidence                                                                       |
| -------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 10.1 Jump helper           | Complete | `jumpToMessage` searches back at most 50 anchors, centers the target, and removes the highlight after two seconds.                                          | `tests/jump-to-message.test.ts`                                                     |
| 10.2 Content scanner       | Complete | Two-pass scanner reattributes tool results to the owning tool-use array index and tool name.                                                                | `tests/session-resources.test.ts`                                                   |
| 10.3 Resizable drawer      | Complete | Non-modal fixed drawer uses pointer capture, 280–720 px clamping, and no backdrop/body lock.                                                                | `tests/session-drawer.test.tsx`, `src/components/session-drawer.stories.tsx`        |
| 10.4 File extraction       | Complete | Typed tool inputs and home-scoped regex results merge into canonical paths with stable occurrence buckets/counts.                                           | `tests/session-files.test.ts`                                                       |
| 10.5 Files drawer          | Complete | Session route memoizes extraction; source filters, persistent drawer state, search, copies, hidden-target chips, and message jumps are wired.               | `tests/files-drawer.test.tsx`, `tests/jump-chips.test.tsx`                          |
| 10.6 Link extraction       | Complete | Markdown-first extraction prevents double counts; URLs retain meaningful fragments, remove tracking parameters, and use ordered universal/user rules.       | `tests/session-links.test.ts`                                                       |
| 10.7 Link rules setting    | Complete | List-valued settings use validated JSON persistence; Settings supports ordered add/edit/delete/reorder.                                                     | `tests/settings-list-values.test.ts`, `tests/settings-link-category-rules.test.tsx` |
| 10.8 Links drawer          | Complete | Mutually-exclusive drawer state, source toggle, filter-expanded categories, safe external links, copies, jump chips, and the empty enricher seam are wired. | `tests/links-drawer.test.tsx`                                                       |
| 10.9 Image byte route      | Complete | Requested file and roots are realpathed before containment; type, regular-file, size, cache, and ETag rules are enforced.                                   | `tests/api-image-containment.test.ts`                                               |
| 10.10 Inline path images   | Complete | User-only absolute image references are deduplicated, checked against allowed roots, kept alongside text, lazy-loaded, and hidden on error.                 | `tests/inline-path-images.test.tsx`                                                 |
| 10.11 Incremental file FTS | Complete | `file_content_fts` uses the existing tokenizer; allow-listed scans skip unchanged/binary/large files and watcher updates handle add/change/delete.          | `tests/db/file-content-fts.test.ts`, `tests/watcher.test.ts`                        |
| 10.12 File search API      | Complete | Scope is realpath-validated; FTS results preserve line numbers, mark snippets, filename/path ranking, caps, totals, and truncation.                         | `tests/api-search-files.test.ts`                                                    |
| 10.13 File viewer          | Complete | Containment-checked text API rejects binary/non-files; the viewer renders syntax-aware lines, valid `#L<n>` anchors, scrolling, and highlighting.           | `tests/api-file-containment.test.ts`, `tests/file-viewer.test.tsx`                  |
| 10.14 Search results UI    | Complete | Debounced scoped query forwards cancellation, persists URL state, supports keyboard selection/expansion, and opens the exact matched line.                  | `tests/file-search-results.test.tsx`                                                |

## §11 — platform ideas

| Item                            | Status   | Behavior and wiring evidence                                                                                                                                      | Test evidence                                                                                                    |
| ------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 11.1 Hook activity state        | Complete | `stateForEvent` covers every known hook event, including manual compaction asymmetry and notification non-authority.                                              | `tests/session-state.test.ts`                                                                                    |
| 11.2 Store/dispatcher state     | Complete | Active entries default to unknown; dispatcher applies one non-null transition before normal event handling.                                                       | `tests/active-session-store.test.ts`, `tests/hook-dispatcher.test.ts`                                            |
| 11.3 Approval fusion            | Complete | Session summaries prefer durable pending approvals and include `blockedSince`; API and SSE use the same builder.                                                  | `tests/session-summary.test.ts`, `tests/pending-approvals.test.ts`                                               |
| 11.4 Urgency/stable sorting     | Complete | `STATE_RANK` and stable creation comparator are consumed by the active page and sidebar; the persisted mode is editable in Settings.                              | `tests/session-state.test.ts`, `tests/active-sessions.test.ts`, settings coverage suites                         |
| 11.5 Waiting heat               | Complete | Active API carries approval age; both active lists recompute time and pass warm/hot only for waiting sessions.                                                    | `tests/session-state.test.ts`, `tests/status-dot.test.tsx`, `tests/active-sessions.test.ts`                      |
| 11.6 Needs-review latch         | Complete | Local storage raises on observed work, clears after detail-page dwell, supports manual per-row/all clearing, and seeds manual-transition history.                 | `tests/unread-store.test.ts`, `tests/session-unread-control.test.tsx`, `tests/session-viewed-visibility.test.ts` |
| 11.7 Transition notifications   | Complete | Bridge seeds state, notifies only transitions into waiting/review, tags by session, and suppresses only the visible current session.                              | `tests/desktop-notification-bridge.test.ts`, `tests/use-claude-events.test.ts`                                   |
| 11.8 Badge/title count          | Complete | Root bridge shares the notification gate, prefixes/restores title, and feature-detects Promise-returning badge APIs.                                              | `tests/attention-badge-bridge.test.ts`                                                                           |
| 11.9 Typed statusline batch     | Complete | Loose third-party schema maps optional metrics; one validated route reads many IDs and returns null for absent files.                                             | `tests/statusline.test.ts`, `tests/schemas.test.ts`                                                              |
| 11.10 Live subagent nodes       | Complete | HMR store has five-minute ended TTL, per-session cap, start/stop ingestion, Stop reconciliation for killed nodes, and JSONL-preferred merging.                    | `tests/live-subagent-store.test.ts`, `tests/subagent-tree.test.ts`, dispatcher tests                             |
| 11.11 Read-only MCP             | Complete | Stdio server exposes the four required tools plus safe extensions over a read-only WAL database, with paging/caps and no state mutations.                         | `tests/mcp-server.test.ts`                                                                                       |
| 11.12 Working-copy diff         | Complete | Builder includes tracked, staged, and untracked files and accepts the expected `--no-index` exit code 1.                                                          | `tests/working-copy-diff.test.ts`                                                                                |
| 11.13 Review bundle/API         | Complete | Strict finding/bundle contracts, JSON-backed review table, wholesale create/findings update, get route, and same-origin guards are wired.                         | `tests/db/reviews-routes.test.ts`                                                                                |
| 11.14 Review skill/Stop trigger | Complete | Installed skill consumes the bundle before prior findings and forbids independent fact gathering; Stop offers/auto-runs via a non-modal banner and Claude runner. | `tests/working-copy-review.test.ts`, `tests/review-offer-banner.test.tsx`                                        |
| 11.15 Context injection         | Complete | Opt-in second `SessionStart` matcher safely curls a bounded plain-text brief of open tasks, recent plans, and title-only decisions.                               | `tests/context-brief.test.ts`, `tests/hook-config.test.ts`                                                       |
| 11.16 Capability pattern        | Complete | MCP, review, and context brief keep persisted enabled/config separate from computed installed/available, retain enabled degraded UI, and hide only by intent.     | `tests/capabilities.test.ts`, settings schema/coverage tests                                                     |
| 11.17 Deterministic screenshots | Complete | Playwright uses isolated fixtures, pinned `Date`, disabled animation/caret, external-request blocking, eight targets, and a renderer/font manifest drift gate.    | `tests/screenshots-script.test.ts`; committed renderer manifest and regenerated PNGs                             |

## Intentional non-task decisions

These recommendations were deliberately outside the 54-item task index and are not implementation
gaps:

- **Deferred (2):** the contested screenshot-stash page; browser GUI mutation for plugin or
  marketplace installation.
- **Skipped / do not build (4):** inline document commenting, fleet restore, a ccp-owned
  session-supervising daemon, and usage analytics.
- **Deliberately absent details:** link hover providers (the empty extension seam exists), a new
  “projects” container, and fixes for the two markdown behaviors already handled correctly by
  markdown-it.

## Verification limits

Automated tests exercise fake sockets/servers, reconnects, protocol errors, containment escapes,
DOM behavior, fixture databases, and deterministic Playwright capture. This audit did not type a
prompt into, interrupt, or attach an observer to a disposable live herdr/Claude pane, and did not
repeat interactive browser inspection because no in-app browser backend was available. Those are
environmental live-check limitations, not deferred code paths; the corresponding deterministic
integration and component tests are listed above.
