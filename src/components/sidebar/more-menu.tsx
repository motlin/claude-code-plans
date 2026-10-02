import {Checkbox} from "@base-ui/react/checkbox";
import {Dialog} from "@base-ui/react/dialog";
import {useNavigate} from "@tanstack/react-router";
import {Check, ChevronDown, X} from "lucide-react";
import {useState} from "react";
import {useSetNavSectionPinned} from "../../lib/api/application-settings";
import type {NavSection} from "../../lib/nav-sections";
import {Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger} from "../ui/menu";
import {navItems, type NavItem} from "./navigation";
import type {Section} from "./types";

export interface NavBadge {
	count: number;
	title: string;
}

const NAV_ROW_CLASS =
	"group mb-[0.5px] flex h-[var(--sb-row-h)] min-w-0 flex-1 items-center gap-[var(--sb-row-gap)] rounded-[var(--sb-radius)] px-[var(--sb-row-px)] text-left text-[length:var(--sb-row-font)] leading-[1.5] text-secondary no-underline outline-none hover:bg-[var(--sb-hover)] focus-visible:bg-[var(--sb-hover)] data-[popup-open]:bg-[var(--sb-hover)] [&_.df-leading-slot]:text-secondary";

/**
 * Upstream's sidebar "More" row: a right-side popover listing the nav items that are not pinned,
 * then a separator and "Edit sidebar…", which opens the pin checklist dialog.
 */
export function MoreNavMenu({
	overflow,
	visibleNavSections,
	badgeFor,
}: {
	overflow: readonly NavItem[];
	visibleNavSections: readonly NavSection[];
	badgeFor: (section: Section) => NavBadge | null;
}) {
	const navigate = useNavigate();
	const [editing, setEditing] = useState(false);

	return (
		<>
			<div className="flex items-center">
				<Menu>
					<MenuTrigger aria-label="More navigation items" className={NAV_ROW_CLASS}>
						<span className="df-leading-slot">
							<ChevronDown aria-hidden="true" className="opacity-50" />
						</span>
						<span className="min-w-0 flex-1 truncate text-ink-muted">More</span>
					</MenuTrigger>
					<MenuContent density="comfortable" side="right" align="start">
						{overflow.map((item) => {
							const Icon = item.icon;
							const badge = badgeFor(item.section);
							return (
								<MenuItem key={item.section} onSelect={() => void navigate({to: item.to})}>
									<span className="flex min-w-0 items-center gap-2">
										<span className="flex size-5 shrink-0 items-center justify-center">
											<Icon aria-hidden="true" className="size-4" />
										</span>
										<span className="truncate">{item.label}</span>
										{badge !== null && badge.count > 0 && (
											<span
												title={badge.title}
												className="ml-2 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-none font-semibold text-white"
											>
												{badge.count}
											</span>
										)}
									</span>
								</MenuItem>
							);
						})}
						{overflow.length > 0 && <MenuSeparator />}
						<MenuItem onSelect={() => setEditing(true)}>Edit sidebar…</MenuItem>
					</MenuContent>
				</Menu>
			</div>
			<EditSidebarDialog open={editing} onOpenChange={setEditing} visibleNavSections={visibleNavSections} />
		</>
	);
}

/** Upstream's 400px "Edit sidebar" dialog: one checkbox per toggleable nav item, then Done. */
function EditSidebarDialog({
	open,
	onOpenChange,
	visibleNavSections,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	visibleNavSections: readonly NavSection[];
}) {
	const setPinned = useSetNavSectionPinned();
	const visible = new Set(visibleNavSections);

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Backdrop className="fixed inset-0 z-50 bg-backdrop backdrop-blur-[2px] transition-opacity duration-200 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
				<Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-surface-3 text-body text-primary shadow-panel-lg outline-none transition-[opacity,scale] duration-200 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none">
					<div className="isolate flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[inherit] p-6">
						<div className="mb-4 flex items-start gap-2">
							<div className="-mt-1 flex min-w-0 flex-1 flex-col gap-1">
								<Dialog.Title className="text-[17px] leading-6 font-semibold break-words text-primary">
									Edit sidebar
								</Dialog.Title>
								<Dialog.Description className="text-body text-secondary">
									Choose which items appear in your sidebar.
								</Dialog.Description>
							</div>
							<Dialog.Close
								aria-label="Close"
								className="-me-2 -mt-2 flex aspect-square h-8 w-8 shrink-0 items-center justify-center rounded-r6 text-primary transition-colors hover:bg-fill-ghost-hover focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none"
							>
								<X aria-hidden="true" className="h-5 w-5" />
							</Dialog.Close>
						</div>
						<div className="mt-2 flex flex-col">
							{navItems.map((item) => {
								const Icon = item.icon;
								return (
									<Checkbox.Root
										key={item.section}
										checked={visible.has(item.section)}
										onCheckedChange={(checked) => setPinned(item.section, checked)}
										className="group/cb -mx-2 inline-flex w-auto items-start gap-2 rounded-r6 px-2 py-1 text-left text-body text-primary outline-none hover:bg-fill-ghost-hover focus-visible:shadow-[0_0_0_2px_var(--accent-100)]"
									>
										<span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-r4 border border-strong group-data-[checked]/cb:border-transparent group-data-[checked]/cb:bg-accent-100">
											<Checkbox.Indicator>
												<Check aria-hidden="true" className="size-3 text-white" />
											</Checkbox.Indicator>
										</span>
										<span className="flex items-center gap-2 pl-1">
											<Icon aria-hidden="true" className="size-4 shrink-0 text-secondary" />
											{item.label}
										</span>
									</Checkbox.Root>
								);
							})}
						</div>
						<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
							<Dialog.Close className="h-8 rounded-r6 bg-fill-primary px-3 text-body font-medium text-on-primary transition-colors hover:bg-fill-primary-hover focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none">
								Done
							</Dialog.Close>
						</div>
					</div>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
