import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Custom (legacy) commands are listed inside Customize › Skills, as
 * claude.ai/code merges commands into skills.
 */
export function redirectLegacyCommand(): never {
  throw redirect({ to: "/customize/skills", search: { filter: "command" }, replace: true });
}

export const Route = createFileRoute("/command/$source/$filename")({
  beforeLoad: redirectLegacyCommand,
});
