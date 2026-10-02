# Perf baselines

Recorded 2026-10-02 on `f0b26406`, following `.llm/perf/measurement-plan.md` §4.4, §4.5 and §5. This file is a snapshot; `tests/perf/ceilings.json` stays the source of truth for the ratchet.

## How it was measured

- `PERF_LARGE=1 just perf`: 291 tests passed, 3 skipped. One timing test (`tests/perf/event-loop-stalls.test.ts` > "leaves out activities that ended before the stalled window") failed under load in the full run and passed when run alone. No ratchet failed.
- `just perf-bundle`: production build bundle sizes.
- `just perf-lab-ratchet --port 7593`: headless browser lab, 5 runs, median ratcheted. All 9 `browser.*` metrics matched their ceilings.
- `just perf-ceilings`: no ids were added or lowered, so `tests/perf/ceilings.json` was already up to date and did not change. All four bundle sizes are above their ceilings but within the 1% tolerance, so the helper left them alone (a raise needs a hand-written reason).

## Browser lab (min/median/max over 5 runs)

| Journey | recalcStyle | layout   | requests    | CLS                  | Title                            |
| ------- | ----------- | -------- | ----------- | -------------------- | -------------------------------- |
| J1      | 38/43/49    | 9/10/10  | 472/472/472 | 0/0/0                | Cold launch to Home              |
| J2      | 56/68/72    | 14/15/15 | 645/645/645 | 0.021/0.021/0.021    | Open a session by URL (typical)  |
| J3      | 46/48/51    | 12/13/13 | 14/14/14    | 0/0/0                | Switch sessions from the sidebar |
| J4      | 33/35/38    | 3/3/3    | 2/2/2       | 0.0001/0.0001/0.0001 | Live append painted              |
| J5      | 99/104/109  | 33/33/33 | 5/5/5       | 0/0/0                | Type in the composer             |
| J6      | 67/71/72    | 21/21/21 | 2/2/2       | 0/0/0                | ⌘K palette open + search         |

Only the 9 metrics proven stable (`browser.J1.requests`, `browser.J2.requests`, `browser.J5.layoutCount`, `browser.J6.layoutCount` and the CLS of J1 to J5) are ratcheted. Style-recalc counts and the other layout counts stay diagnostic.

## Field p75 (F metrics): provisional, no samples yet

`just perf-report` printed "No field perf samples recorded." The field sink directory `$XDG_CACHE_HOME/claude-code-plans/perf/` does not exist yet, so no `field-*.jsonl` log has ever been written. The field journeys (F1 to F13) landed only in the last few commits, so the prod server the user runs has not yet been rebuilt with them, or has not received a beacon since.

| F metric  | Bucket (origin × formFactor) |   n | p75  |
| --------- | ---------------------------- | --: | ---- |
| F1 to F13 | localhost × desktop          |   0 | none |
| F1 to F13 | remote × desktop             |   0 | none |
| F1 to F13 | localhost × phone            |   0 | none |
| F1 to F13 | remote × phone               |   0 | none |

A bucket needs n ≥ 30 before its p75 counts as a baseline (§4.5). To fill this table:

1. Rebuild and restart prod with this commit or a later one (`just build`, then `just start`).
2. Use the app normally for at least 3 days, on localhost and also through the proxy or phone if you use them.
3. Run `just perf-report --since 7d` and replace the table above with p75 per F metric and bucket. Mark every bucket with n < 30 as provisional.

## Lab counts (all ratcheted ids)

Measured values from `node_modules/.cache/ccb-perf/results.json` after the runs above, next to their ceilings.

| Metric                                                               |           Measured |            Ceiling | Tolerance | Unit     |
| -------------------------------------------------------------------- | -----------------: | -----------------: | --------: | -------- |
| `browser.J1.layoutShift`                                             |                  0 |                  0 |         0 | cls      |
| `browser.J1.requests`                                                |                472 |                472 |      0.02 | requests |
| `browser.J2.layoutShift`                                             |              0.021 |              0.021 |         0 | cls      |
| `browser.J2.requests`                                                |                645 |                645 |         0 | requests |
| `browser.J3.layoutShift`                                             |                  0 |                  0 |         0 | cls      |
| `browser.J4.layoutShift`                                             |             0.0001 |             0.0001 |         0 | cls      |
| `browser.J5.layoutCount`                                             |                 33 |                 33 |         0 | count    |
| `browser.J5.layoutShift`                                             |                  0 |                  0 |         0 | cls      |
| `browser.J6.layoutCount`                                             |                 21 |                 21 |         0 | count    |
| `bundle.home.gzip`                                                   |             396527 |             394847 |      0.01 | bytes    |
| `bundle.home.raw`                                                    |            1244740 |            1240047 |      0.01 | bytes    |
| `bundle.session.gzip`                                                |             722084 |             717005 |      0.01 | bytes    |
| `bundle.session.raw`                                                 |            2314860 |            2303535 |      0.01 | bytes    |
| `client.coldHome.default.commitsToRows`                              |                 11 |                 11 |         0 | count    |
| `client.coldHome.default.fetches`                                    |                 18 |                 18 |         0 | count    |
| `client.coldHome.default.responseBytes`                              |               3536 |               3536 |         0 | bytes    |
| `client.coldHome.localSections.commitsToRows`                        |                  5 |                  5 |         0 | count    |
| `client.coldHome.localSections.fetches`                              |                 19 |                 19 |         0 | count    |
| `client.coldHome.localSections.responseBytes`                        |               3717 |               3717 |         0 | bytes    |
| `client.composer.home.slashMenu.claudeEventsConsumers`               |                  1 |                  1 |         0 | count    |
| `client.composer.home.slashMenu.commitsPerKeystroke`                 |                  1 |                  1 |         0 | count    |
| `client.composer.home.slashMenu.componentsPerKeystroke`              |                  7 |                  7 |         0 | count    |
| `client.composer.home.slashMenu.localStorageWrites`                  |                  1 |                  1 |         0 | count    |
| `client.composer.home.slashMenu.queryCacheListeners`                 |                  1 |                  1 |         0 | count    |
| `client.composer.home.typing.claudeEventsConsumers`                  |                  1 |                  1 |         0 | count    |
| `client.composer.home.typing.commitsPerKeystroke`                    |                  1 |                  1 |         0 | count    |
| `client.composer.home.typing.componentsPerKeystroke`                 |                1.4 |                1.4 |         0 | count    |
| `client.composer.home.typing.localStorageWrites`                     |                  1 |                  1 |         0 | count    |
| `client.composer.home.typing.queryCacheListeners`                    |                  1 |                  1 |         0 | count    |
| `client.composer.session.mentionMenu.claudeEventsConsumers`          |                  4 |                  4 |         0 | count    |
| `client.composer.session.mentionMenu.commitsPerKeystroke`            |                  2 |                  2 |         0 | count    |
| `client.composer.session.mentionMenu.componentsPerKeystroke`         |                  9 |                  9 |         0 | count    |
| `client.composer.session.mentionMenu.localStorageWrites`             |                  1 |                  1 |         0 | count    |
| `client.composer.session.mentionMenu.queryCacheListeners`            |                  2 |                  2 |         0 | count    |
| `client.composer.session.mentionMenu.sessionChatRendersPerKeystroke` |                  0 |                  0 |         0 | count    |
| `client.composer.session.slashMenu.claudeEventsConsumers`            |                  4 |                  4 |         0 | count    |
| `client.composer.session.slashMenu.commitsPerKeystroke`              |                  1 |                  1 |         0 | count    |
| `client.composer.session.slashMenu.componentsPerKeystroke`           |                  7 |                  7 |         0 | count    |
| `client.composer.session.slashMenu.localStorageWrites`               |                  1 |                  1 |         0 | count    |
| `client.composer.session.slashMenu.queryCacheListeners`              |                  2 |                  2 |         0 | count    |
| `client.composer.session.slashMenu.sessionChatRendersPerKeystroke`   |                  0 |                  0 |         0 | count    |
| `client.composer.session.typing.claudeEventsConsumers`               |                  4 |                  4 |         0 | count    |
| `client.composer.session.typing.commitsPerKeystroke`                 |                  1 |                  1 |         0 | count    |
| `client.composer.session.typing.componentsPerKeystroke`              |                1.4 |                1.4 |         0 | count    |
| `client.composer.session.typing.localStorageWrites`                  |                  1 |                  1 |         0 | count    |
| `client.composer.session.typing.queryCacheListeners`                 |                  2 |                  2 |         0 | count    |
| `client.composer.session.typing.sessionChatRendersPerKeystroke`      |                  0 |                  0 |         0 | count    |
| `client.liveAppendMulti.appendOffScreen.commits`                     |                  1 |                  1 |         0 | count    |
| `client.liveAppendMulti.appendOffScreen.fetches`                     |                  0 |                  0 |         0 | count    |
| `client.liveAppendMulti.appendOffScreen.hiddenReloads`               |                  0 |                  0 |         0 | count    |
| `client.liveEvent.appendOpen.commits`                                |                  3 |                  3 |         0 | count    |
| `client.liveEvent.appendOpen.fetches`                                |                  0 |                  0 |         0 | count    |
| `client.liveEvent.appendOpen.hiddenReloads`                          |                  0 |                  0 |         0 | count    |
| `client.liveEvent.appendOpen.mutations`                              |                  5 |                  5 |         0 | count    |
| `client.liveEvent.appendOther.commits`                               |                  1 |                  1 |         0 | count    |
| `client.liveEvent.appendOther.fetches`                               |                  0 |                  0 |         0 | count    |
| `client.liveEvent.appendOther.hiddenReloads`                         |                  0 |                  0 |         0 | count    |
| `client.liveEvent.appendOther.mutations`                             |                  0 |                  0 |         0 | count    |
| `client.liveEvent.reconnect.commits`                                 |                  2 |                  2 |         0 | count    |
| `client.liveEvent.reconnect.fetches`                                 |                  6 |                  6 |         0 | count    |
| `client.liveEvent.reconnect.hiddenReloads`                           |                  6 |                  6 |         0 | count    |
| `client.liveEvent.reconnect.mutations`                               |                  0 |                  0 |         0 | count    |
| `client.liveEvent.sessionUpdated.commits`                            |                  0 |                  0 |         0 | count    |
| `client.liveEvent.sessionUpdated.fetches`                            |                  2 |                  2 |         0 | count    |
| `client.liveEvent.sessionUpdated.hiddenReloads`                      |                  2 |                  2 |         0 | count    |
| `client.liveEvent.sessionUpdated.mutations`                          |                  0 |                  0 |         0 | count    |
| `client.liveEvent.toolPending.commits`                               |                  1 |                  1 |         0 | count    |
| `client.liveEvent.toolPending.fetches`                               |                  0 |                  0 |         0 | count    |
| `client.liveEvent.toolPending.hiddenReloads`                         |                  0 |                  0 |         0 | count    |
| `client.liveEvent.toolPending.mutations`                             |                  0 |                  0 |         0 | count    |
| `client.palette.open.commits`                                        |                  7 |                  7 |         0 | count    |
| `client.palette.open.fetches`                                        |                  0 |                  0 |         0 | count    |
| `client.palette.open.mutations`                                      |                 44 |                 44 |         0 | count    |
| `client.palette.search.commitsPerKeystroke`                          | 2.8333333333333335 | 2.8333333333333335 |         0 | count    |
| `client.palette.search.mutations`                                    |                111 |                111 |         0 | count    |
| `client.palette.search.serverSearchFetches`                          |                  1 |                  1 |         0 | count    |
| `client.sessionOpen.small.commits`                                   |                 12 |                 12 |         0 | count    |
| `client.sessionOpen.small.commits.SessionChat`                       |                  5 |                  5 |         0 | count    |
| `client.sessionOpen.small.commits.SessionPage`                       |                  7 |                  7 |         0 | count    |
| `client.sessionOpen.small.fetches`                                   |                  9 |                  9 |         0 | count    |
| `client.sessionOpen.small.mountedRows`                               |                  4 |                  4 |         0 | count    |
| `client.sessionOpen.small.mutations`                                 |                 31 |                 31 |         0 | count    |
| `client.sessionOpen.typical.commits`                                 |                 12 |                 12 |         0 | count    |
| `client.sessionOpen.typical.commits.SessionChat`                     |                  5 |                  5 |         0 | count    |
| `client.sessionOpen.typical.commits.SessionPage`                     |                  7 |                  7 |         0 | count    |
| `client.sessionOpen.typical.fetches`                                 |                  9 |                  9 |         0 | count    |
| `client.sessionOpen.typical.mountedRows`                             |                  4 |                  4 |         0 | count    |
| `client.sessionOpen.typical.mutations`                               |                 31 |                 31 |         0 | count    |
| `client.sessionSwitch.small.commits`                                 |                 10 |                 10 |         0 | count    |
| `client.sessionSwitch.small.commits.SessionChat`                     |                  5 |                  5 |         0 | count    |
| `client.sessionSwitch.small.commits.SessionPage`                     |                  6 |                  6 |         0 | count    |
| `client.sessionSwitch.small.fetches`                                 |                  8 |                  8 |         0 | count    |
| `client.sessionSwitch.small.hoverPrefetch.fetches`                   |                  4 |                  4 |         0 | count    |
| `client.sessionSwitch.small.mountedRows`                             |                  4 |                  4 |         0 | count    |
| `client.sessionSwitch.small.mutations`                               |                 34 |                 34 |         0 | count    |
| `client.sessionSwitch.typical.commits`                               |                 10 |                 10 |         0 | count    |
| `client.sessionSwitch.typical.commits.SessionChat`                   |                  5 |                  5 |         0 | count    |
| `client.sessionSwitch.typical.commits.SessionPage`                   |                  6 |                  6 |         0 | count    |
| `client.sessionSwitch.typical.fetches`                               |                  8 |                  8 |         0 | count    |
| `client.sessionSwitch.typical.hoverPrefetch.fetches`                 |                  4 |                  4 |         0 | count    |
| `client.sessionSwitch.typical.mountedRows`                           |                  4 |                  4 |         0 | count    |
| `client.sessionSwitch.typical.mutations`                             |                 34 |                 34 |         0 | count    |
| `hot.claudeEventsReducer.replay-200.calls`                           |                300 |                300 |         0 | calls    |
| `hot.paletteRanking.500x5.calls`                                     |              10282 |              10282 |         0 | calls    |
| `hot.processTranscript.large-long.calls`                             |               2514 |               2514 |         0 | calls    |
| `hot.processTranscript.large-wide.calls`                             |                958 |                958 |         0 | calls    |
| `hot.processTranscript.small.calls`                                  |               3924 |               3924 |         0 | calls    |
| `hot.processTranscript.typical.calls`                                |               2743 |               2743 |         0 | calls    |
| `server.coldLoad.approvals.resp.bytes`                               |                 16 |                 16 |         0 | bytes    |
| `server.coldLoad.approvals.sql.count`                                |                  0 |                  0 |         0 | count    |
| `server.coldLoad.composerDefaults.resp.bytes`                        |                 85 |                 85 |         0 | bytes    |
| `server.coldLoad.composerDefaults.sql.count`                         |                  0 |                  0 |         0 | count    |
| `server.coldLoad.homeStats.resp.bytes`                               |                328 |                328 |         0 | bytes    |
| `server.coldLoad.homeStats.sql.count`                                |                  2 |                  2 |         0 | count    |
| `server.coldLoad.notifications.resp.bytes`                           |                 20 |                 20 |         0 | bytes    |
| `server.coldLoad.notifications.sql.count`                            |                  1 |                  1 |         0 | count    |
| `server.coldLoad.plans.resp.bytes`                                   |                  2 |                  2 |         0 | bytes    |
| `server.coldLoad.plans.sql.count`                                    |                  3 |                  3 |         0 | count    |
| `server.coldLoad.plugins.resp.bytes`                                 |                  2 |                  2 |         0 | bytes    |
| `server.coldLoad.plugins.sql.count`                                  |                  0 |                  0 |         0 | count    |
| `server.coldLoad.projects.resp.bytes`                                |               1051 |               1051 |         0 | bytes    |
| `server.coldLoad.projects.sql.count`                                 |                 11 |                 11 |         0 | count    |
| `server.coldLoad.promptHistory.resp.bytes`                           |                  2 |                  2 |         0 | bytes    |
| `server.coldLoad.promptHistory.sql.count`                            |                  0 |                  0 |         0 | count    |
| `server.coldLoad.sessionsActive.resp.bytes`                          |                  2 |                  2 |         0 | bytes    |
| `server.coldLoad.sessionsActive.sql.count`                           |                  1 |                  1 |         0 | count    |
| `server.coldLoad.sessionsGrouped.resp.bytes`                         |              12824 |              12824 |         0 | bytes    |
| `server.coldLoad.sessionsGrouped.sql.count`                          |                  6 |                  6 |         0 | count    |
| `server.coldLoad.sessionsRecent.resp.bytes`                          |              12381 |              12381 |         0 | bytes    |
| `server.coldLoad.sessionsRecent.sql.count`                           |                  4 |                  4 |         0 | count    |
| `server.liveAppend.large-long.1.jsonl.fullScans`                     |                  1 |                  1 |         0 | count    |
| `server.liveAppend.large-long.1.readAmplification`                   |              93900 |              93900 |         0 | ratio    |
| `server.liveAppend.large-long.20.jsonl.fullScans`                    |                  0 |                  0 |         0 | count    |
| `server.liveAppend.large-long.20.readAmplification`                  |                  3 |                  3 |         0 | ratio    |
| `server.liveAppend.large-long.20.sql.count`                          |                 25 |                 25 |         0 | count    |
| `server.liveAppend.large-long.20.sse.payloadBytes`                   |               4768 |               4768 |         0 | bytes    |
| `server.liveAppend.large-wide.1.jsonl.fullScans`                     |                  1 |                  1 |         0 | count    |
| `server.liveAppend.large-wide.1.readAmplification`                   |             300473 |             300473 |         0 | ratio    |
| `server.liveAppend.large-wide.20.jsonl.fullScans`                    |                  0 |                  0 |         0 | count    |
| `server.liveAppend.large-wide.20.readAmplification`                  |                  3 |                  3 |         0 | ratio    |
| `server.liveAppend.large-wide.20.sql.count`                          |                 23 |                 23 |         0 | count    |
| `server.liveAppend.large-wide.20.sse.payloadBytes`                   |               4828 |               4828 |         0 | bytes    |
| `server.liveAppend.small.1.jsonl.fullScans`                          |                  1 |                  1 |         0 | count    |
| `server.liveAppend.small.1.readAmplification`                        |               2407 |               2407 |         0 | ratio    |
| `server.liveAppend.small.20.jsonl.fullScans`                         |                  0 |                  0 |         0 | count    |
| `server.liveAppend.small.20.readAmplification`                       |                  3 |                  3 |         0 | ratio    |
| `server.liveAppend.small.20.sql.count`                               |                 23 |                 23 |         0 | count    |
| `server.liveAppend.small.20.sse.payloadBytes`                        |               4631 |               4631 |         0 | bytes    |
| `server.liveAppend.typical.1.jsonl.fullScans`                        |                  1 |                  1 |         0 | count    |
| `server.liveAppend.typical.1.readAmplification`                      |              21432 |              21432 |         0 | ratio    |
| `server.liveAppend.typical.20.jsonl.fullScans`                       |                  0 |                  0 |         0 | count    |
| `server.liveAppend.typical.20.readAmplification`                     |                  3 |                  3 |         0 | ratio    |
| `server.liveAppend.typical.20.sql.count`                             |                 23 |                 23 |         0 | count    |
| `server.liveAppend.typical.20.sse.payloadBytes`                      |               4667 |               4667 |         0 | bytes    |
| `server.liveAppendMulti.jsonl.bytesRead`                             |            2512800 |            2512800 |         0 | bytes    |
| `server.liveAppendMulti.jsonl.fullScans`                             |                  5 |                  5 |         0 | count    |
| `server.liveAppendMulti.sse.deliveredBytes`                          |              19272 |              19272 |         0 | bytes    |
| `server.search.miss.sql.count`                                       |                  5 |                  5 |         0 | count    |
| `server.search.phrase.sql.count`                                     |                  5 |                  5 |         0 | count    |
| `server.search.word.sql.count`                                       |                  5 |                  5 |         0 | count    |
| `server.sessionOpen.large-long.detail.jsonl.bytesRead`               |           20000000 |           20000000 |         0 | bytes    |
| `server.sessionOpen.large-long.detail.jsonl.fullScans`               |                  1 |                  1 |         0 | count    |
| `server.sessionOpen.large-long.detail.proc.spawned`                  |                  2 |                  2 |         0 | count    |
| `server.sessionOpen.large-long.detail.sql.count`                     |                 12 |                 12 |         0 | count    |
| `server.sessionOpen.large-long.subagents.jsonl.bytesRead`            |                  0 |                  0 |         0 | bytes    |
| `server.sessionOpen.large-long.subagents.jsonl.fullScans`            |                  0 |                  0 |         0 | count    |
| `server.sessionOpen.large-long.subagents.proc.spawned`               |                  0 |                  0 |         0 | count    |
| `server.sessionOpen.large-long.subagents.resp.bytes`                 |                  2 |                  2 |         0 | bytes    |
| `server.sessionOpen.large-long.subagents.sql.count`                  |                  1 |                  1 |         0 | count    |
| `server.sessionOpen.large-long.transcript.jsonl.bytesRead`           |           20000000 |           20000000 |         0 | bytes    |
| `server.sessionOpen.large-long.transcript.jsonl.fullScans`           |                  1 |                  1 |         0 | count    |
| `server.sessionOpen.large-long.transcript.proc.spawned`              |                  0 |                  0 |         0 | count    |
| `server.sessionOpen.large-long.transcript.resp.bytes`                |             523332 |             523332 |         0 | bytes    |
| `server.sessionOpen.large-long.transcript.sql.count`                 |                  1 |                  1 |         0 | count    |
| `server.sessionOpen.large-wide.detail.jsonl.bytesRead`               |           64000000 |           64000000 |         0 | bytes    |
| `server.sessionOpen.large-wide.detail.jsonl.fullScans`               |                  1 |                  1 |         0 | count    |
| `server.sessionOpen.large-wide.detail.proc.spawned`                  |                  2 |                  2 |         0 | count    |
| `server.sessionOpen.large-wide.detail.sql.count`                     |                 12 |                 12 |         0 | count    |
| `server.sessionOpen.large-wide.subagents.jsonl.bytesRead`            |                  0 |                  0 |         0 | bytes    |
| `server.sessionOpen.large-wide.subagents.jsonl.fullScans`            |                  0 |                  0 |         0 | count    |
| `server.sessionOpen.large-wide.subagents.proc.spawned`               |                  0 |                  0 |         0 | count    |
| `server.sessionOpen.large-wide.subagents.resp.bytes`                 |                  2 |                  2 |         0 | bytes    |
| `server.sessionOpen.large-wide.subagents.sql.count`                  |                  1 |                  1 |         0 | count    |
| `server.sessionOpen.large-wide.transcript.jsonl.bytesRead`           |           64000000 |           64000000 |         0 | bytes    |
| `server.sessionOpen.large-wide.transcript.jsonl.fullScans`           |                  1 |                  1 |         0 | count    |
| `server.sessionOpen.large-wide.transcript.proc.spawned`              |                  0 |                  0 |         0 | count    |
| `server.sessionOpen.large-wide.transcript.resp.bytes`                |             485043 |             485043 |         0 | bytes    |
| `server.sessionOpen.large-wide.transcript.sql.count`                 |                  1 |                  1 |         0 | count    |
| `server.sessionOpen.small.detail.jsonl.bytesRead`                    |             500000 |             500000 |         0 | bytes    |
| `server.sessionOpen.small.detail.jsonl.fullScans`                    |                  1 |                  1 |         0 | count    |
| `server.sessionOpen.small.detail.proc.spawned`                       |                  2 |                  2 |         0 | count    |
| `server.sessionOpen.small.detail.sql.count`                          |                 12 |                 12 |         0 | count    |
| `server.sessionOpen.small.subagents.jsonl.bytesRead`                 |                  0 |                  0 |         0 | bytes    |
| `server.sessionOpen.small.subagents.jsonl.fullScans`                 |                  0 |                  0 |         0 | count    |
| `server.sessionOpen.small.subagents.proc.spawned`                    |                  0 |                  0 |         0 | count    |
| `server.sessionOpen.small.subagents.resp.bytes`                      |                  2 |                  2 |         0 | bytes    |
| `server.sessionOpen.small.subagents.sql.count`                       |                  1 |                  1 |         0 | count    |
| `server.sessionOpen.small.transcript.jsonl.bytesRead`                |             500000 |             500000 |         0 | bytes    |
| `server.sessionOpen.small.transcript.jsonl.fullScans`                |                  1 |                  1 |         0 | count    |
| `server.sessionOpen.small.transcript.proc.spawned`                   |                  0 |                  0 |         0 | count    |
| `server.sessionOpen.small.transcript.resp.bytes`                     |             500074 |             500074 |         0 | bytes    |
| `server.sessionOpen.small.transcript.sql.count`                      |                  1 |                  1 |         0 | count    |
| `server.sessionOpen.typical.detail.jsonl.bytesRead`                  |            4500000 |            4500000 |         0 | bytes    |
| `server.sessionOpen.typical.detail.jsonl.fullScans`                  |                  1 |                  1 |         0 | count    |
| `server.sessionOpen.typical.detail.proc.spawned`                     |                  2 |                  2 |         0 | count    |
| `server.sessionOpen.typical.detail.sql.count`                        |                 12 |                 12 |         0 | count    |
| `server.sessionOpen.typical.subagents.jsonl.bytesRead`               |                  0 |                  0 |         0 | bytes    |
| `server.sessionOpen.typical.subagents.jsonl.fullScans`               |                  0 |                  0 |         0 | count    |
| `server.sessionOpen.typical.subagents.proc.spawned`                  |                  0 |                  0 |         0 | count    |
| `server.sessionOpen.typical.subagents.resp.bytes`                    |                  2 |                  2 |         0 | bytes    |
| `server.sessionOpen.typical.subagents.sql.count`                     |                  1 |                  1 |         0 | count    |
| `server.sessionOpen.typical.transcript.jsonl.bytesRead`              |            4500000 |            4500000 |         0 | bytes    |
| `server.sessionOpen.typical.transcript.jsonl.fullScans`              |                  1 |                  1 |         0 | count    |
| `server.sessionOpen.typical.transcript.proc.spawned`                 |                  0 |                  0 |         0 | count    |
| `server.sessionOpen.typical.transcript.resp.bytes`                   |             495796 |             495796 |         0 | bytes    |
| `server.sessionOpen.typical.transcript.sql.count`                    |                  1 |                  1 |         0 | count    |
