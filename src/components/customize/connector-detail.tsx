import {useQuery, useQueryClient} from "@tanstack/react-query";
import {ArrowLeft, Ban, Check, ChevronDown, CircleCheck, Copy, Ellipsis, Hand, type LucideIcon} from "lucide-react";
import {useState} from "react";
import type {McpServerDetail, McpToolPermission} from "../../lib/api/customize";
import {settingsQueryOptions, useSaveSettingsFile} from "../../lib/api/settings";
import {writeClipboardText} from "../../lib/clipboard";
import {
	blanketChoice,
	mergePermissionRules,
	setToolPermission,
	toolPermissionChoice,
	type ToolPermissionChoice,
} from "../../lib/customize/mcp-tool-permissions";
import {Switch} from "../settings/switch";
import {useToast} from "../toast";
import {Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger} from "../ui/menu";
import {ConnectorTile, connectorDomain} from "./connector-tile";
import {SCOPE_LABEL, ScopeBadge, transportLabel} from "./connectors-table";
import {CustomizeLink} from "./customize-nav";

const CHOICES: readonly {value: ToolPermissionChoice; label: string; icon: LucideIcon}[] = [
	{value: "allow", label: "Always allow", icon: CircleCheck},
	{value: "ask", label: "Needs approval", icon: Hand},
	{value: "blocked", label: "Blocked", icon: Ban},
];

function choiceOf(tool: McpToolPermission): ToolPermissionChoice {
	return toolPermissionChoice(tool.behavior);
}

function CopyServerButton({detail}: {detail: McpServerDetail}) {
	const {server} = detail;
	const toast = useToast();
	const [copied, setCopied] = useState(false);
	const isUrl = server.transport !== "stdio";
	const Icon = copied ? Check : Copy;

	const copy = async () => {
		const ok = await writeClipboardText(server.urlOrCommand);
		setCopied(ok);
		toast(
			ok
				? {kind: "success", message: isUrl ? "Server URL copied" : "Command copied"}
				: {kind: "error", message: "Copy failed"},
		);
	};

	return (
		<button
			type="button"
			aria-label={isUrl ? "Copy server URL" : "Copy command"}
			onClick={() => void copy()}
			className="inline-flex max-w-full items-center gap-1.5 text-left text-footnote text-t6 transition-colors hover:text-secondary"
		>
			<span className="truncate font-mono">{server.urlOrCommand}</span>
			<Icon aria-hidden="true" className="size-3.5 shrink-0" />
		</button>
	);
}

/** Upstream connector detail header: back link, tile, H2, then the copyable URL or command. */
export function ConnectorDetailHeader({detail}: {detail: McpServerDetail}) {
	const {server} = detail;
	const secretKeys = [...server.envKeys, ...server.headerKeys];
	return (
		<header className="flex flex-col gap-3">
			<CustomizeLink
				target={{kind: "list", section: "connectors"}}
				className="-ms-2 inline-flex w-fit items-center gap-1.5 rounded-r6 px-2 py-1 text-body text-secondary no-underline hover:bg-fill-ghost-hover hover:text-primary"
			>
				<ArrowLeft aria-hidden="true" className="size-4" />
				Your connectors
			</CustomizeLink>
			<div className="flex min-h-14 items-center gap-3 py-1">
				<ConnectorTile name={server.name} domain={connectorDomain(server.transport, server.urlOrCommand)} />
				<h2 className="m-0 truncate text-[18px]/[24px] font-semibold text-primary">{server.name}</h2>
				<div className="flex items-center gap-1 text-footnote text-secondary">
					<span>{transportLabel(server.transport)}</span>
					<ScopeBadge>{SCOPE_LABEL[server.scope]}</ScopeBadge>
					{!server.enabled && <span className="ps-1 text-t6">Disabled</span>}
				</div>
			</div>
			<CopyServerButton detail={detail} />
			{server.projectPath !== undefined && (
				<p className="m-0 text-footnote text-t6">
					Project <span className="font-mono">{server.projectPath}</span>
				</p>
			)}
			{secretKeys.length > 0 && (
				<p className="m-0 text-footnote text-t6">
					Configured secrets <span className="font-mono">{secretKeys.join(", ")}</span> (values hidden)
				</p>
			)}
		</header>
	);
}

const RADIO_CLASS =
	"relative inline-flex h-full items-center justify-center rounded-r4 px-2.5 text-t6 outline-none enabled:hover:text-primary focus-visible:outline-2 focus-visible:outline-accent-100 disabled:cursor-default aria-checked:bg-surface-0 aria-checked:text-primary aria-checked:shadow-[inset_0_0_0_1px_var(--color-border),0_1px_2px_0_rgb(0_0_0/0.05)]";

interface PermissionControlProps {
	tool: string;
	value: ToolPermissionChoice;
	disabled: boolean;
	onChange: (choice: ToolPermissionChoice) => void;
}

/** Upstream three-icon SegmentedControl: Always allow / Needs approval / Blocked. */
function PermissionControl({tool, value, disabled, onChange}: PermissionControlProps) {
	return (
		<div
			role="radiogroup"
			aria-label={tool}
			className="relative inline-flex h-8 w-fit items-stretch rounded-r6 bg-fill-ghost-hover p-px"
		>
			{CHOICES.map(({value: choice, label, icon: Icon}) => (
				<button
					key={choice}
					type="button"
					role="radio"
					aria-label={label}
					title={label}
					aria-checked={value === choice}
					disabled={disabled}
					onClick={() => {
						if (value !== choice) onChange(choice);
					}}
					className={RADIO_CLASS}
				>
					<Icon aria-hidden="true" className="size-4" />
				</button>
			))}
		</div>
	);
}

interface ToolGroupProps {
	title: string;
	tools: readonly McpToolPermission[];
	editable: boolean;
	onChange: (tools: readonly string[], choice: ToolPermissionChoice) => void;
}

function ToolGroup({title, tools, editable, onChange}: ToolGroupProps) {
	const [expanded, setExpanded] = useState(true);
	const blanket = blanketChoice(tools.map(choiceOf));
	const blanketOption = CHOICES.find((choice) => choice.value === blanket);
	const BlanketIcon = blanketOption?.icon ?? Ellipsis;

	return (
		<div role="group" aria-label={title} className="flex w-full flex-col border-b border-border last:border-b-0">
			<div className="flex items-center gap-2.5 py-2">
				<button
					type="button"
					aria-expanded={expanded}
					onClick={() => setExpanded(!expanded)}
					className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
				>
					<ChevronDown
						aria-hidden="true"
						className={`size-4 shrink-0 text-secondary transition-transform duration-200 ${expanded ? "" : "-rotate-90"}`}
					/>
					<span className="text-body text-primary">{title}</span>
					<ScopeBadge>{tools.length}</ScopeBadge>
				</button>
				<Menu>
					<MenuTrigger
						aria-label="Blanket permission for group"
						disabled={!editable}
						className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-r6 border border-border px-2.5 text-body text-primary hover:bg-fill-ghost-hover disabled:cursor-default disabled:opacity-60"
					>
						<BlanketIcon aria-hidden="true" className="-ms-0.5 size-4" />
						{blanketOption?.label ?? "Custom"}
						<ChevronDown aria-hidden="true" className="size-3.5 opacity-60" />
					</MenuTrigger>
					<MenuContent align="end">
						<MenuRadioGroup
							value={blanket}
							onValueChange={(next: string) => {
								const choice = CHOICES.find((option) => option.value === next);
								if (choice !== undefined) {
									onChange(
										tools.map((tool) => tool.name),
										choice.value,
									);
								}
							}}
						>
							{CHOICES.map((choice) => (
								<MenuRadioItem key={choice.value} value={choice.value}>
									{choice.label}
								</MenuRadioItem>
							))}
							{blanket === "custom" && (
								<MenuRadioItem value="custom" disabled>
									Custom
								</MenuRadioItem>
							)}
						</MenuRadioGroup>
					</MenuContent>
				</Menu>
			</div>
			{expanded && (
				<div className="flex flex-col">
					{tools.map((tool) => (
						<div
							key={tool.name}
							className="flex min-h-14 items-center gap-4 border-b border-border py-2 ps-6 last:border-b-0"
						>
							<div className="flex min-w-0 flex-1 flex-col">
								<span className="truncate font-mono text-body text-secondary">{tool.name}</span>
								{tool.rule !== null && (
									<span className="truncate text-caption text-t6">
										{tool.behavior} rule <span className="font-mono">{tool.rule}</span>
									</span>
								)}
							</div>
							<PermissionControl
								tool={tool.name}
								value={choiceOf(tool)}
								disabled={!editable}
								onChange={(choice) => onChange([tool.name], choice)}
							/>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Upstream "Tool permissions": read-only and write/delete groups of tools,
 * each with a three-way control and a blanket menu. Locally the state comes
 * from ~/.claude/settings.json allow/ask/deny rules. Controls stay read-only
 * until "Edit tool permissions" is switched on; each change then rewrites the
 * rule lists through the same PUT /api/settings/settings.json save the
 * settings editor uses.
 */
export function ToolPermissions({
	detail,
	detailQueryKey,
}: {
	detail: McpServerDetail;
	detailQueryKey: readonly unknown[];
}) {
	const queryClient = useQueryClient();
	const toast = useToast();
	const saveSettings = useSaveSettingsFile();
	const settings = useQuery(settingsQueryOptions);
	const [editing, setEditing] = useState(false);
	const settingsFile = settings.data?.find((file) => file.filename === "settings.json");
	const editable = editing && settingsFile !== undefined && !saveSettings.isPending;

	const readOnlyTools = detail.tools.filter((tool) => tool.readOnly);
	const writeTools = detail.tools.filter((tool) => !tool.readOnly);
	const toolNames = detail.tools.map((tool) => tool.name);

	const change = async (tools: readonly string[], choice: ToolPermissionChoice) => {
		try {
			// Re-read settings.json so a write never clobbers edits made elsewhere.
			const files = await queryClient.fetchQuery({...settingsQueryOptions, staleTime: 0});
			const file = files.find((candidate) => candidate.filename === "settings.json");
			const parsed: unknown = JSON.parse(file?.content ?? "{}");
			if (!isRecord(parsed)) throw new Error("settings.json is not a JSON object");
			const permissions = isRecord(parsed["permissions"]) ? parsed["permissions"] : {};
			const list = (key: string): string[] => {
				const value = permissions[key];
				return Array.isArray(value) ? value.filter((rule): rule is string => typeof rule === "string") : [];
			};
			let rules = {allow: list("allow"), ask: list("ask"), deny: list("deny")};
			for (const tool of tools) {
				rules = setToolPermission(rules, detail.serverKey, toolNames, tool, choice);
			}
			const next = mergePermissionRules(parsed, rules);
			await saveSettings.mutateAsync({
				filename: "settings.json",
				content: JSON.stringify(next, null, 2),
			});
			await queryClient.invalidateQueries({queryKey: detailQueryKey});
			toast({kind: "success", message: "Tool permissions saved"});
		} catch (error) {
			toast({kind: "error", message: `Could not save: ${(error as Error).message}`});
		}
	};

	return (
		<section aria-labelledby="tool-permissions-heading" className="mt-6 flex flex-col">
			<div className="flex items-start justify-between gap-2">
				<div className="flex w-full flex-col gap-2">
					<h3 id="tool-permissions-heading" className="m-0 text-body font-semibold text-primary">
						Tool permissions
					</h3>
					<p className="m-0 text-body text-t6">
						Choose when Claude is allowed to use these tools. Rules are read from ~/.claude/settings.json.
					</p>
				</div>
				<label className="flex shrink-0 items-center gap-2 text-footnote text-secondary">
					Edit
					<Switch
						aria-label="Edit tool permissions"
						checked={editing}
						disabled={settingsFile === undefined}
						onCheckedChange={setEditing}
					/>
				</label>
			</div>
			{detail.tools.length === 0 ? (
				<p className="m-0 mt-4 text-body text-secondary">
					No tools seen yet. Tools appear here once Claude calls them in a session or a permission rule names
					them.
				</p>
			) : (
				<div className="mt-2 flex flex-col">
					{readOnlyTools.length > 0 && (
						<ToolGroup
							title="Read-only tools"
							tools={readOnlyTools}
							editable={editable}
							onChange={(tools, choice) => void change(tools, choice)}
						/>
					)}
					{writeTools.length > 0 && (
						<ToolGroup
							title="Write/delete tools"
							tools={writeTools}
							editable={editable}
							onChange={(tools, choice) => void change(tools, choice)}
						/>
					)}
				</div>
			)}
		</section>
	);
}
