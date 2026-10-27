import {Ellipsis} from "lucide-react";
import type {ReactNode} from "react";

import {setProjectAppearance, useProjectAppearance} from "../../lib/project-appearance-store";
import {ContextMenu, ContextMenuTrigger, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger} from "../ui/menu";
import {KEBAB_CLASS} from "./custom-group-header";
import {GroupAppearanceSubmenu} from "./group-appearance";
import {useAfterMenuClose} from "./use-after-menu-close";

/** Upstream `zl` `place-unknown`: why "Other" or a project whose folder is gone can't start a session. */
const PLACE_UNKNOWN = "Where these sessions run isn’t known, so there’s nowhere to start a new one.";

/**
 * The label of a Project section with a header menu (right-click or hover
 * kebab): upstream's `rv` "New session" (disabled with the place-unknown
 * reason when the section has no folder), then the section's Icon and color
 * picker, like upstream's `folderAppearanceByKey`.
 */
export function ProjectGroupHeader({
	groupKey,
	label,
	onNewSession,
	children,
}: {
	groupKey: string;
	label: string;
	/** Starts a session in this project's folder, or null when it has none. */
	onNewSession: (() => void) | null;
	/** The label's toggle button. */
	children: ReactNode;
}) {
	const appearance = useProjectAppearance()[groupKey];
	// The composer takes focus, so New session acts only once the menu has closed.
	const {later, menuProps, contentProps} = useAfterMenuClose();
	const items = (
		<>
			<MenuItem
				disabled={onNewSession === null}
				disabledReason={PLACE_UNKNOWN}
				onSelect={later(() => onNewSession?.())}
			>
				New session
			</MenuItem>
			<MenuSeparator />
			<GroupAppearanceSubmenu
				appearance={appearance}
				onChange={(patch) => {
					setProjectAppearance(groupKey, patch);
				}}
			/>
		</>
	);
	return (
		<>
			<div className="flex min-w-0 flex-1 items-center">
				<ContextMenu {...menuProps}>
					<ContextMenuTrigger className="flex min-w-0 flex-1">{children}</ContextMenuTrigger>
					<MenuContent {...contentProps}>{items}</MenuContent>
				</ContextMenu>
			</div>
			<Menu {...menuProps}>
				<MenuTrigger aria-label={`More options for ${label}`} data-row-action="" className={KEBAB_CLASS}>
					<Ellipsis aria-hidden="true" className="size-4" />
				</MenuTrigger>
				<MenuContent align="end" {...contentProps}>
					{items}
				</MenuContent>
			</Menu>
		</>
	);
}
