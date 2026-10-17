import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {Check, Copy, Settings, Download, Trash2, AlertCircle} from "lucide-react";
import {generateHooksJson, DEFAULT_HOOK_PORT} from "../lib/hook-config";
import {hookStatusQueryOptions, useInstallHooks, useUninstallHooks} from "../lib/api/hooks";
import type {HookStatusResponse} from "../lib/api/hooks";
import type {z} from "zod";
import {errorMessage} from "../lib/narrow";
import {useSettings} from "./settings-context";

type HookStatus = z.infer<typeof HookStatusResponse>;

function keeping(foreignCommands: readonly string[]): string {
	if (foreignCommands.length === 0) return "";
	const noun = foreignCommands.length === 1 ? "hook" : "hooks";
	return `, keeping ${foreignCommands.length} other ${noun}: ${foreignCommands.join("; ")}`;
}

/** What Install would write, event by event: additions, then updates, then stray removals. */
function pendingChanges(status: HookStatus): string[] {
	const adds = status.events
		.filter((event) => event.state === "missing")
		.map((event) => `Add ${event.event}${keeping(event.foreignCommands)}`);
	const updates = status.events
		.filter((event) => event.state === "outdated")
		.map((event) => `Update ${event.event}: ${event.reasons.join("; ")}${keeping(event.foreignCommands)}`);
	const removals = status.strayEvents.map(
		(event) => `Remove ${event}: a WorktreeCreate or WorktreeRemove hook replaces git’s own worktree handling`,
	);
	return [...adds, ...updates, ...removals];
}

function featureState(feature: HookStatus["features"][number]): string {
	if (feature.state === "on") return "On";
	if (feature.state === "partial") return `Partial — missing optional ${feature.missingOptional.join(", ")}`;
	return `Off — needs ${feature.missingRequired.join(", ")}`;
}

const FEATURE_STATE_CLASS = {
	on: "text-green-700 dark:text-green-400",
	partial: "text-amber-700 dark:text-amber-400",
	off: "text-secondary",
} as const;

export function HookSetup() {
	const {settings} = useSettings();
	const [port, setPort] = useState(DEFAULT_HOOK_PORT);
	const [copied, setCopied] = useState(false);
	const [message, setMessage] = useState<{
		type: "success" | "error";
		text: string;
	} | null>(null);
	const [showJson, setShowJson] = useState(false);

	const {data: status} = useQuery(hookStatusQueryOptions);
	const installMutation = useInstallHooks();
	const uninstallMutation = useUninstallHooks();
	const installing = installMutation.isPending;
	const uninstalling = uninstallMutation.isPending;

	const includeContextBrief = settings.capabilities.sessionContextBrief.enabled;
	const json = generateHooksJson({port, includeContextBrief});

	function handleCopy() {
		void navigator.clipboard.writeText(json);
		setCopied(true);
		setTimeout(() => {
			setCopied(false);
		}, 1500);
	}

	const changes = status ? pendingChanges(status) : [];
	const upToDate = status ? status.events.filter((event) => event.state === "current").length : 0;
	const updateOnly =
		status?.missingEvents.length === 0 && (status.outdatedEvents.length > 0 || status.strayEvents.length > 0);

	async function handleInstall() {
		setMessage(null);
		try {
			const result = await installMutation.mutateAsync({
				port,
				capabilities: settings.capabilities,
			});
			setMessage({
				type: "success",
				text: `Hooks installed to ${result.settingsPath}${result.backupPath === undefined ? "" : ` (previous file saved as ${result.backupPath})`}`,
			});
		} catch (err) {
			setMessage({type: "error", text: errorMessage(err)});
		}
	}

	async function handleUninstall() {
		setMessage(null);
		try {
			const result = await uninstallMutation.mutateAsync({port});
			setMessage({
				type: "success",
				text: `Hooks removed from ${result.settingsPath}${result.backupPath === undefined ? "" : ` (previous file saved as ${result.backupPath})`}`,
			});
		} catch (err) {
			setMessage({type: "error", text: errorMessage(err)});
		}
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-3">
				<Settings className="h-5 w-5 text-secondary" />
				<h2 className="text-base font-semibold text-primary">Hook Configuration</h2>
			</div>

			<p className="text-sm text-secondary">
				Hooks enable real-time session tracking and push-based updates. Each hook fires a lightweight POST to
				the local server whenever Claude starts/ends sessions, completes tools, or finishes tasks.
				WorktreeCreate and WorktreeRemove are never installed: a hook on either replaces git’s own worktree
				handling.
			</p>

			{status && (
				<div
					role="status"
					className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
						status.installed
							? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300"
							: status.partial || updateOnly
								? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
								: "border-border bg-surface-0 text-secondary"
					}`}
				>
					{status.installed ? (
						<>
							<Check className="h-4 w-4" />
							All {status.totalCount} hooks installed
						</>
					) : updateOnly ? (
						<>
							<AlertCircle className="h-4 w-4" />
							{status.outdatedEvents.length > 0
								? `${status.outdatedEvents.length}/${status.totalCount} hooks installed but outdated — Update hooks`
								: `All ${status.totalCount} hooks installed, plus ${status.strayEvents.length} that must be removed — Update hooks`}
						</>
					) : status.partial ? (
						<>
							<AlertCircle className="h-4 w-4" />
							{status.installedCount}/{status.totalCount} hooks installed
							{status.outdatedEvents.length > 0 ? `, ${status.outdatedEvents.length} outdated` : ""}
						</>
					) : (
						<>
							<AlertCircle className="h-4 w-4" />
							Hooks not installed
						</>
					)}
				</div>
			)}

			{status && (
				<div className="space-y-1">
					<h3 id="hook-features" className="text-sm font-medium text-primary">
						Features the hooks power
					</h3>
					<ul aria-labelledby="hook-features" className="space-y-0.5 text-sm">
						{status.features.map((feature) => (
							<li key={feature.id} className="flex justify-between gap-3">
								<span className="text-secondary">{feature.label}</span>{" "}
								<span className={FEATURE_STATE_CLASS[feature.state]}>{featureState(feature)}</span>
							</li>
						))}
					</ul>
				</div>
			)}

			{status && changes.length > 0 && (
				<div className="space-y-1">
					<h3 id="hook-changes" className="text-sm font-medium text-primary">
						Changes Install will make
					</h3>
					<ul
						aria-labelledby="hook-changes"
						className="list-disc space-y-0.5 pl-5 font-mono text-xs text-secondary"
					>
						{changes.map((change) => (
							<li key={change} className="break-all">
								{change}
							</li>
						))}
					</ul>
					<p className="text-xs text-secondary">
						{upToDate > 0 ? `${upToDate} other events are already up to date. ` : ""}
						Hooks from other tools stay in place, and the current {status.settingsPath} is copied to
						settings.json.bak before anything is written.
					</p>
				</div>
			)}

			<div className="flex items-center gap-3">
				<label htmlFor="hook-port" className="text-sm text-secondary">
					Server port
				</label>
				<input
					id="hook-port"
					type="number"
					value={port}
					onChange={(e) => {
						setPort(Number(e.target.value) || DEFAULT_HOOK_PORT);
					}}
					className="w-24 rounded-md border border-border bg-surface-1 px-2 py-1 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent-100"
				/>
			</div>

			<div className="flex items-center gap-2">
				{status?.installed ? (
					<button
						type="button"
						onClick={() => {
							void handleUninstall();
						}}
						disabled={uninstalling}
						className="flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
					>
						<Trash2 className="h-3.5 w-3.5" />
						{uninstalling ? "Removing..." : "Uninstall Hooks"}
					</button>
				) : (
					<button
						type="button"
						onClick={() => {
							void handleInstall();
						}}
						disabled={installing}
						className="flex items-center gap-1.5 rounded-md bg-accent-100 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-100/80 disabled:opacity-50"
					>
						<Download className="h-3.5 w-3.5" />
						{installing ? "Installing..." : updateOnly ? "Update Hooks" : "Install Hooks"}
					</button>
				)}
				<button
					type="button"
					onClick={() => {
						setShowJson(!showJson);
					}}
					className="rounded-md border border-border px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface-0"
				>
					{showJson ? "Hide JSON" : "Show JSON"}
				</button>
			</div>

			{message && (
				<div
					className={`rounded-md border px-3 py-2 text-sm ${
						message.type === "success"
							? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300"
							: "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300"
					}`}
				>
					{message.text}
				</div>
			)}

			{showJson && (
				<div className="relative">
					<button
						type="button"
						onClick={handleCopy}
						className="absolute right-2 top-2 flex items-center gap-1.5 rounded-md border border-border bg-surface-0 px-2.5 py-1 text-xs text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary"
						title="Copy to clipboard"
					>
						{copied ? (
							<>
								<Check className="h-3.5 w-3.5 text-green-500" />
								<span>Copied</span>
							</>
						) : (
							<>
								<Copy className="h-3.5 w-3.5" />
								<span>Copy</span>
							</>
						)}
					</button>
					<pre className="overflow-auto rounded-md border border-border bg-surface-0 p-4 pr-24 font-mono text-xs leading-relaxed text-secondary">
						{json}
					</pre>
				</div>
			)}
		</div>
	);
}
