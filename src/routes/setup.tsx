import {createFileRoute} from "@tanstack/react-router";
import {CodePageHeader} from "../components/code-page-header";
import {HookSetup} from "../components/hook-setup";

export const Route = createFileRoute("/setup")({
	component: SetupPage,
	head: () => ({
		meta: [{title: "Setup"}],
	}),
});

function SetupPage() {
	return (
		<div className="max-w-3xl">
			<CodePageHeader
				title="Setup"
				subtitle="Configure Claude Code to send hook events to this server for live updates."
			/>
			<div className="mt-2">
				<HookSetup />
			</div>
		</div>
	);
}
