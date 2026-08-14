import { createFileRoute } from "@tanstack/react-router";
import { HookSetup } from "../components/hook-setup";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
  head: () => ({
    meta: [{ title: "Setup" }],
  }),
});

function SetupPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-lg font-semibold">Setup</h1>
      <p className="mt-1 text-sm text-t6">
        Configure Claude Code to send hook events to this server for live updates.
      </p>
      <div className="mt-6">
        <HookSetup />
      </div>
    </div>
  );
}
