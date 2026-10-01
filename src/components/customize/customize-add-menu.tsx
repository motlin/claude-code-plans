import {useQuery} from "@tanstack/react-query";
import {ChevronDown} from "lucide-react";
import {customizeSkillsQueryOptions} from "../../lib/api/customize";
import {writeClipboardText} from "../../lib/clipboard";
import {startClaudeSession} from "../../lib/start-claude-session";
import {useToast} from "../toast";
import {Menu, MenuContent, MenuItem, MenuTrigger} from "../ui/menu";
import type {CustomizeSectionId} from "./sections";

const ADD_BUTTON_CLASS =
	"inline-flex h-8 shrink-0 items-center gap-1 rounded-r6 bg-fill-primary pr-2.5 pl-3 text-body font-medium text-on-primary transition-colors hover:bg-fill-primary-hover focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none";

const SKILL_CREATOR = "skill-creator";
const PLUGIN_CREATOR_PROMPT = "Create a new Claude Code plugin";
const MARKETPLACE_ADD_COMMAND = "claude plugin marketplace add ";
const MCP_ADD_COMMAND = "claude mcp add ";

const ADD_LABEL: Record<CustomizeSectionId, string> = {
	skills: "Add skill",
	plugins: "Add plugin",
	connectors: "Add connector",
};

/** `/skill-creator` when that skill is installed, else a plain request Claude can act on. */
function skillCreatorPrompt(skillNames: readonly string[]): string {
	return skillNames.includes(SKILL_CREATOR) ? `/${SKILL_CREATOR}` : "Create a new skill";
}

/**
 * Upstream's filled "Add ▾" Customize menu, limited to the actions that work
 * locally: "Create with Claude" starts `claude` in a new herdr tab, and the
 * marketplace and connector items copy the CLI command to finish in a
 * terminal. Upload and the Create-a-… forms need claude.ai storage.
 */
export function CustomizeAddMenu({section}: {section: CustomizeSectionId}) {
	const toast = useToast();
	const {data: skills} = useQuery({...customizeSkillsQueryOptions, enabled: section === "skills"});

	const create = (prompt: string) => void startClaudeSession(prompt, {toast});
	const copyCommand = async (command: string) => {
		const copied = await writeClipboardText(command);
		toast(
			copied
				? {kind: "success", message: `Command copied: ${command.trim()}`}
				: {kind: "error", message: "Copy failed"},
		);
	};

	return (
		<Menu>
			<MenuTrigger aria-label={ADD_LABEL[section]} className={ADD_BUTTON_CLASS}>
				Add
				<ChevronDown aria-hidden="true" className="size-4" />
			</MenuTrigger>
			<MenuContent align="end">
				{section === "skills" && (
					<MenuItem onSelect={() => create(skillCreatorPrompt((skills ?? []).map((skill) => skill.name)))}>
						Create with Claude
					</MenuItem>
				)}
				{section === "plugins" && (
					<>
						<MenuItem onSelect={() => void copyCommand(MARKETPLACE_ADD_COMMAND)}>Add marketplace</MenuItem>
						<MenuItem onSelect={() => create(PLUGIN_CREATOR_PROMPT)}>Create with Claude</MenuItem>
					</>
				)}
				{section === "connectors" && (
					<MenuItem onSelect={() => void copyCommand(MCP_ADD_COMMAND)}>Add custom connector</MenuItem>
				)}
			</MenuContent>
		</Menu>
	);
}
