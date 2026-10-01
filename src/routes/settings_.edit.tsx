import {useSuspenseQuery} from "@tanstack/react-query";
import {createFileRoute, Link} from "@tanstack/react-router";
import {Code, SlidersHorizontal, X} from "lucide-react";
import {useState} from "react";
import {FormEditor, JsonEditor} from "../components/settings/settings-editors";
import {settingsQueryOptions} from "../lib/api/settings";

export const Route = createFileRoute("/settings_/edit")({
	component: SettingsEditPage,
	loader: ({context: {queryClient}}) => queryClient.ensureQueryData(settingsQueryOptions),
	head: () => ({
		meta: [{title: "Edit Settings"}],
	}),
});

type EditorTab = "form" | "json";

function SettingsEditPage() {
	const {data: files} = useSuspenseQuery(settingsQueryOptions);
	const [activeTab, setActiveTab] = useState<EditorTab>("form");

	return (
		<div className="max-w-4xl">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-lg font-semibold">Edit Settings</h1>
					<p className="mt-1 text-sm text-t6">
						Edit Claude Code configuration files from <code className="font-mono text-xs">~/.claude/</code>
					</p>
				</div>
				<div className="flex items-center gap-2">
					<div className="flex rounded-md border border-border">
						<button
							type="button"
							onClick={() => setActiveTab("form")}
							className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors first:rounded-l-md ${
								activeTab === "form" ? "bg-accent-100 text-white" : "text-secondary hover:bg-surface-0"
							}`}
						>
							<SlidersHorizontal className="h-3.5 w-3.5" />
							Form
						</button>
						<button
							type="button"
							onClick={() => setActiveTab("json")}
							className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors last:rounded-r-md ${
								activeTab === "json" ? "bg-accent-100 text-white" : "text-secondary hover:bg-surface-0"
							}`}
						>
							<Code className="h-3.5 w-3.5" />
							JSON
						</button>
					</div>
					<Link
						to="/settings"
						className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface-0"
					>
						<X className="h-3.5 w-3.5" />
						Cancel
					</Link>
				</div>
			</div>

			<div className="mt-6 space-y-10">
				{files.map((file) =>
					activeTab === "form" ? (
						<FormEditor
							key={`form-${file.filename}`}
							filename={file.filename}
							initialContent={file.content}
							path={file.path}
						/>
					) : (
						<JsonEditor
							key={`json-${file.filename}`}
							filename={file.filename}
							initialContent={file.content}
							path={file.path}
						/>
					),
				)}
			</div>
		</div>
	);
}
