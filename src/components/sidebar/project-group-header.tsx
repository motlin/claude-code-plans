import {Ellipsis} from "lucide-react";
import type {ReactNode} from "react";

import {setProjectAppearance, useProjectAppearance} from "../../lib/project-appearance-store";
import {ContextMenu, ContextMenuTrigger, Menu, MenuContent, MenuTrigger} from "../ui/menu";
import {KEBAB_CLASS} from "./custom-group-header";
import {GroupAppearanceSubmenu} from "./group-appearance";

/**
 * The label of a Project section with a header menu (right-click or hover
 * kebab) holding the section's Icon and color picker, like upstream's
 * `folderAppearanceByKey`.
 */
export function ProjectGroupHeader({
	groupKey,
	label,
	children,
}: {
	groupKey: string;
	label: string;
	/** The label's toggle button. */
	children: ReactNode;
}) {
	const appearance = useProjectAppearance()[groupKey];
	const items = (
		<GroupAppearanceSubmenu appearance={appearance} onChange={(patch) => setProjectAppearance(groupKey, patch)} />
	);
	return (
		<>
			<div className="flex min-w-0 flex-1 items-center">
				<ContextMenu>
					<ContextMenuTrigger className="flex min-w-0 flex-1">{children}</ContextMenuTrigger>
					<MenuContent>{items}</MenuContent>
				</ContextMenu>
			</div>
			<Menu>
				<MenuTrigger aria-label={`More options for ${label}`} data-row-action="" className={KEBAB_CLASS}>
					<Ellipsis aria-hidden="true" className="size-4" />
				</MenuTrigger>
				<MenuContent align="end">{items}</MenuContent>
			</Menu>
		</>
	);
}
