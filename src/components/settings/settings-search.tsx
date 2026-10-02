import {Popover} from "@base-ui/react/popover";
import {Search} from "lucide-react";
import {useId, useMemo, useRef, useState} from "react";
import {settingsTabLabels} from "../../lib/schema-choices";
import type {SettingsTab} from "../../lib/settings-hash";
import {searchSettings, splitMatch, type SettingsSearchResult} from "../../lib/settings-search";
import {SETTINGS_TAB_ICONS} from "./settings-tab-icons";

/**
 * The Settings nav search field. Typing opens upstream's 280px results popover (padding 4): one
 * 14/20 r8 row per match, the tab icon then a "Tab / Row" breadcrumb with the match in the accent
 * color. Choosing a result hands its tab and row to `onSelect`.
 */
export function SettingsSearch({onSelect}: {onSelect: (tab: SettingsTab, row: string) => void}) {
	const [query, setQuery] = useState("");
	const [dismissed, setDismissed] = useState(false);
	const anchorRef = useRef<HTMLDivElement>(null);
	const listId = useId();
	const groups = useMemo(() => searchSettings(query), [query]);
	const needleLength = query.trim().length;
	const open = !dismissed && needleLength > 0;

	const choose = (result: SettingsSearchResult) => {
		setQuery("");
		setDismissed(false);
		onSelect(result.tab, result.rowSlug);
	};

	return (
		<>
			<div
				ref={anchorRef}
				className="flex h-8 shrink-0 items-center gap-2 rounded-r6 border border-border bg-[var(--settings-field-bg)] px-2.5 text-secondary focus-within:ring-2 focus-within:ring-accent-100/40"
			>
				<Search aria-hidden="true" className="size-4 shrink-0" />
				<input
					type="text"
					role="combobox"
					aria-label="Search settings"
					aria-expanded={open}
					aria-controls={open ? listId : undefined}
					aria-autocomplete="list"
					placeholder="Search"
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setDismissed(false);
					}}
					onKeyDown={(event) => {
						if (event.key === "Escape" && open) {
							event.preventDefault();
							event.stopPropagation();
							setDismissed(true);
						} else if (event.key === "Enter") {
							const first = groups[0]?.results[0];
							if (first !== undefined) {
								event.preventDefault();
								choose(first);
							}
						}
					}}
					className="min-w-0 flex-1 bg-transparent text-body text-primary outline-none placeholder:text-[var(--settings-muted)]"
				/>
			</div>
			<Popover.Root
				open={open}
				onOpenChange={(next, details) => {
					if (next) return;
					// Clicks back into the field keep the results open.
					if (
						details.event.target instanceof Node &&
						anchorRef.current?.contains(details.event.target) === true
					) {
						return;
					}
					setDismissed(true);
				}}
			>
				<Popover.Portal>
					<Popover.Positioner
						anchor={anchorRef}
						side="bottom"
						align="start"
						sideOffset={4}
						className="z-[60]"
					>
						<Popover.Popup
							id={listId}
							data-cds="Popover"
							aria-label="Search results"
							initialFocus={false}
							finalFocus={false}
							className="w-[280px] rounded-card bg-[var(--menu-bg)] text-primary shadow-[var(--menu-shadow)] outline-none"
						>
							<div className="max-h-[min(320px,var(--available-height))] overflow-y-auto p-1">
								{groups.length === 0 ? (
									<p className="px-2.5 py-1.5 text-footnote text-[var(--settings-muted)]">
										No results
									</p>
								) : (
									groups.flatMap((group) => {
										const Icon = SETTINGS_TAB_ICONS[group.tab];
										return group.results.map((result) => {
											const parts = splitMatch(result.title, result.start, needleLength);
											return (
												<button
													key={`${result.tab}/${result.rowSlug}`}
													type="button"
													aria-label={`${settingsTabLabels[group.tab]} ${result.title}`}
													onClick={() => choose(result)}
													className="flex w-full items-center gap-2 rounded-r6 px-1 py-1.5 text-left text-body text-primary transition-colors hover:bg-fill-ghost-hover focus-visible:bg-fill-ghost-hover focus-visible:outline-none"
												>
													<Icon aria-hidden="true" className="size-5 shrink-0 p-0.5" />
													<span className="min-w-0 truncate">
														<span data-settings-result-section="">
															{settingsTabLabels[group.tab]}
														</span>
														<span className="text-[var(--settings-muted)]"> / </span>
														<span data-settings-result-title="">
															{parts.before}
															<span className="text-accent-100">{parts.match}</span>
															{parts.after}
														</span>
													</span>
												</button>
											);
										});
									})
								)}
							</div>
						</Popover.Popup>
					</Popover.Positioner>
				</Popover.Portal>
			</Popover.Root>
		</>
	);
}
