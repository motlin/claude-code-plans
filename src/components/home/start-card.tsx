import {Check, Folder} from "lucide-react";

import {requestHomeComposerFocus} from "../../lib/home-composer-focus";
import type {StartProject} from "../../lib/palette-start-session";
import {useHomeLaunchFolder} from "./launch-folder";
import {ProjectPicker} from "./project-picker";

/** Upstream shows at most three recent environments. */
const ROW_LIMIT = 3;

const ROW_CLASS = "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[13px]/5 text-secondary";

/** `/Users/me/x` or `/home/me/x` → `~/x`, like upstream's shortened local cwd. */
function shortenCwd(path: string): string {
	return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

/** The top three folders; a selection outside them takes the third seat. */
function visibleRows(projects: readonly StartProject[], selected: StartProject | undefined): StartProject[] {
	const top = projects.slice(0, ROW_LIMIT);
	if (selected === undefined || top.some((p) => p.id === selected.id)) return top;
	return [...top.slice(0, ROW_LIMIT - 1), selected];
}

interface StartCardProps {
	projects: readonly StartProject[];
	selected: StartProject | undefined;
	onSelect: (projectId: string) => void;
}

/**
 * Upstream's /code start card "Recent environments" list, adapted to recent local folders: the
 * current folder is a static checked row, the others pick the launch folder and focus the composer,
 * and "Choose environment" opens the composer's project picker. Upstream's cloud environments and
 * "Next steps" list have no local equivalent.
 */
export function StartCard({projects, selected, onSelect}: StartCardProps) {
	if (projects.length === 0) return null;

	const choose = (projectId: string) => {
		onSelect(projectId);
		requestHomeComposerFocus();
	};

	return (
		<div data-start-card className="flex w-full min-w-0 flex-col items-center gap-3 p-px">
			<ul
				role="list"
				aria-label="Recent environments"
				className="card-ring flex w-80 max-w-full shrink-0 flex-col rounded-xl bg-surface-1"
			>
				{visibleRows(projects, selected).map((project) => {
					const current = project.id === selected?.id;
					const content = (
						<>
							<Folder aria-hidden="true" className="size-4 shrink-0" />
							<span
								className="min-w-0 flex-1 truncate text-start"
								title={shortenCwd(project.projectPath)}
							>
								{project.name}
							</span>
						</>
					);
					return (
						<li
							key={project.id}
							aria-current={current ? true : undefined}
							className="px-1 pt-0.5 first:pt-1"
						>
							{current ? (
								<div className={ROW_CLASS}>
									{content}
									<Check
										data-start-card-check
										aria-hidden="true"
										className="size-4 shrink-0 text-primary"
									/>
								</div>
							) : (
								<button
									type="button"
									onClick={() => {
										choose(project.id);
									}}
									className={`${ROW_CLASS} transition-colors hover:bg-fill-ghost-hover focus-visible:shadow-[0_0_0_2px_var(--accent-100)] focus-visible:outline-none`}
								>
									{content}
								</button>
							)}
						</li>
					);
				})}
				<li className="pt-1">
					<div aria-hidden="true" className="border-t border-[var(--card-outline)]" />
					<div className="p-1">
						<ProjectPicker variant="choose" projects={projects} selected={selected} onSelect={choose} />
					</div>
				</li>
			</ul>
		</div>
	);
}

/** The start card bound to the shared home launch folder. */
export function HomeStartCard() {
	const {projects, selected, select} = useHomeLaunchFolder();
	return <StartCard projects={projects} selected={selected} onSelect={select} />;
}
