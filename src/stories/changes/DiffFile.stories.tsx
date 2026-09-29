import type { Meta, StoryObj } from "@storybook/react-vite";
import { DiffFile } from "../../components/changes/diff-file";
import { withDarkTheme, withTheme } from "../layout/decorators";

const MODIFIED = `diff --git a/src/lib/greet.ts b/src/lib/greet.ts
index 1111111..2222222 100644
--- a/src/lib/greet.ts
+++ b/src/lib/greet.ts
@@ -1,6 +1,8 @@
 import { format } from "./format";
${" "}
 export function greet(name: string): string {
-  return "hi " + name;
+  const greeting = "hello";
+  return format(greeting, name);
 }
+
+export const loud = (name: string) => greet(name).toUpperCase();
`;

const RENAME = `diff --git a/logs/2019-summary.md b/docs/history/summary.md
similarity index 82%
rename from logs/2019-summary.md
rename to docs/history/summary.md
index 3333333..4444444 100644
--- a/logs/2019-summary.md
+++ b/docs/history/summary.md
@@ -1,4 +1,4 @@
-# 2019 summary
+# Project history
${" "}
 The first release shipped in March.
 The second release shipped in November.
`;

const DELETION = `diff --git a/scripts/legacy-build.sh b/scripts/legacy-build.sh
deleted file mode 100755
index 5555555..0000000
--- a/scripts/legacy-build.sh
+++ /dev/null
@@ -1,5 +0,0 @@
-#!/usr/bin/env bash
-set -euo pipefail
-
-rm -rf dist
-tsc --project tsconfig.build.json
`;

const NO_NEWLINE = `diff --git a/.mise/config.toml b/.mise/config.toml
index 6666666..7777777 100644
--- a/.mise/config.toml
+++ b/.mise/config.toml
@@ -1,2 +1,3 @@
 [tools]
-node = "22"
\\ No newline at end of file
+node = "24"
+pnpm = "11"
\\ No newline at end of file
`;

const CONTEXT_GAP = `diff --git a/src/server/router.ts b/src/server/router.ts
index 8888888..9999999 100644
--- a/src/server/router.ts
+++ b/src/server/router.ts
@@ -421,6 +421,7 @@ export function createRouter() {
   router.get("/health", health);
   router.get("/sessions", listSessions);
   router.get("/sessions/:id", getSession);
+  router.get("/sessions/:id/changes", getSessionChanges);
   router.post("/sessions/:id/star", starSession);
   router.delete("/sessions/:id/star", unstarSession);
   return router;
`;

// Decorate per story: a meta-level light ThemeProvider would wrap the dark one
// and its effect would run last, forcing the Dark story back to light.
const meta = {
  title: "Changes/DiffFile",
  component: DiffFile,
  args: { patch: MODIFIED },
} satisfies Meta<typeof DiffFile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Modified: Story = {
  decorators: [withTheme],
};

export const SideBySide: Story = {
  decorators: [withTheme],
  args: { diffStyle: "split" },
};

export const Rename: Story = {
  decorators: [withTheme],
  args: { patch: RENAME },
};

export const Deletion: Story = {
  decorators: [withTheme],
  args: { patch: DELETION },
};

export const NoNewlineAtEndOfFile: Story = {
  decorators: [withTheme],
  args: { patch: NO_NEWLINE },
};

export const ContextGap: Story = {
  decorators: [withTheme],
  args: { patch: CONTEXT_GAP },
};

export const Collapsed: Story = {
  decorators: [withTheme],
  args: { defaultCollapsed: true },
};

export const Dark: Story = {
  decorators: [withDarkTheme],
};
