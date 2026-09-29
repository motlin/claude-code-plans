import { createFileRoute, redirect } from "@tanstack/react-router";
import { settingsHash } from "../lib/settings-hash";

/** Settings is a hash-routed dialog; the old page URL opens it over the home page. */
export function redirectToSettingsDialog(): never {
  throw redirect({ to: "/", hash: settingsHash("general"), replace: true });
}

export const Route = createFileRoute("/settings")({
  beforeLoad: redirectToSettingsDialog,
});
