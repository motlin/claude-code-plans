import {Ellipsis} from "lucide-react";
import type {SkillSummary} from "../../lib/api/customize";
import {writeClipboardText} from "../../lib/clipboard";
import {useToast} from "../toast";
import {Menu, MenuContent, MenuItem, MenuTrigger} from "../ui/menu";
import {skillInvocation} from "./skills-view";

/**
 * Row kebab "More actions for <name>". Upstream offers Remove; locally the
 * browser cannot open Finder or delete files, so "Open folder" copies the
 * skill directory and "Copy /name" copies the slash command.
 */
export function SkillRowActions({
	skill,
	triggerLabel = `More actions for ${skill.name}`,
}: {
	skill: SkillSummary;
	/** Rows say "More actions for <name>"; the detail header says "More options for <name>". */
	triggerLabel?: string;
}) {
	const toast = useToast();
	const invocation = skillInvocation(skill);

	const copy = async (text: string, message: string) => {
		const copied = await writeClipboardText(text);
		toast(copied ? {kind: "success", message} : {kind: "error", message: "Copy failed"});
	};

	return (
		<Menu>
			<MenuTrigger
				aria-label={triggerLabel}
				className="inline-flex size-7 shrink-0 items-center justify-center rounded-r6 text-t6 transition-colors hover:bg-fill-ghost-hover hover:text-primary aria-expanded:text-primary"
			>
				<Ellipsis aria-hidden="true" className="size-4" />
			</MenuTrigger>
			<MenuContent align="end">
				<MenuItem onSelect={() => void copy(skill.dir, "Folder path copied")}>Open folder</MenuItem>
				<MenuItem onSelect={() => void copy(invocation, `${invocation} copied`)}>Copy {invocation}</MenuItem>
			</MenuContent>
		</Menu>
	);
}
