import {Scroll} from "lucide-react";
import type {ReactNode} from "react";
import type {SkillDetail} from "../../lib/api/customize";
import {countContentsFiles} from "./contents-order";
import {CustomizeBackLink, CustomizeLink} from "./customize-nav";
import {ShortDate} from "./customize-list";
import {DETAIL_TAB_CLASS, DetailTabLabel, DetailTabs} from "./detail-tabs";
import {IconTile} from "./icon-tile";
import {SkillEnableSwitch} from "./skill-enable-switch";
import {SkillRowActions} from "./skill-row-actions";
import {skillInvocation} from "./skills-view";

/**
 * Upstream skill detail header: back link, 44px tile, H2 + "from <source> ·
 * updated <date>", the Enable switch, the kebab, then the underline
 * Overview · Contents · N tabs. The switch writes `skillOverrides`.
 */
export function SkillDetailHeader({detail}: {detail: SkillDetail}) {
	const {skill} = detail;
	return (
		<header className="flex flex-col gap-4">
			<CustomizeBackLink section="skills">Your skills</CustomizeBackLink>
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="flex max-w-max min-w-0 grow basis-40 items-start gap-4">
					<IconTile icon={Scroll} size="lg" />
					<div className="flex min-w-0 flex-col gap-0.5">
						<h2 className="m-0 min-w-0 truncate text-[15px]/[20px] font-[580] text-primary">
							{skill.name}
						</h2>
						<p className="m-0 break-words text-footnote text-muted-as-secondary">
							from {skill.sourceLabel} · updated <ShortDate ms={skill.mtime} />
						</p>
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<SkillEnableSwitch skill={skill} />
					<SkillRowActions skill={skill} triggerLabel={`More options for ${skill.name}`} />
				</div>
			</div>
			<DetailTabs label="Skill sections">
				<CustomizeLink target={{kind: "skill", id: skill.id, tab: "overview"}} className={DETAIL_TAB_CLASS}>
					<DetailTabLabel label="Overview" />
				</CustomizeLink>
				<CustomizeLink target={{kind: "skill", id: skill.id, tab: "contents"}} className={DETAIL_TAB_CLASS}>
					<DetailTabLabel label="Contents" count={countContentsFiles(detail.tree)} />
				</CustomizeLink>
			</DetailTabs>
		</header>
	);
}

function AsideCard({title, children}: {title: string; children: ReactNode}) {
	return (
		<section className="flex flex-col gap-2 rounded-card border border-border bg-surface-0 p-4">
			<h3 className="m-0 text-caption text-secondary">{title}</h3>
			{children}
		</section>
	);
}

function Fact({label, value}: {label: string; value: string}) {
	return (
		<div className="flex items-center justify-between gap-3 text-body">
			<dt className="text-secondary">{label}</dt>
			<dd className="m-0 text-primary">{value}</dd>
		</div>
	);
}

/** Overview tab: the full description beside Source, Invocation and Allowed tools cards. */
export function SkillOverview({detail}: {detail: SkillDetail}) {
	const {skill} = detail;
	const invocation = skillInvocation(skill);
	return (
		<div className="flex flex-col gap-7 md:flex-row md:items-start">
			<section className="flex min-w-0 flex-1 flex-col gap-3">
				<h3 className="m-0 text-caption text-secondary">Description</h3>
				<p data-testid="skill-description" className="m-0 whitespace-pre-wrap text-body text-primary">
					{skill.description === "" ? "No description." : skill.description}
				</p>
			</section>
			<aside className="flex w-full shrink-0 flex-col gap-3 md:w-60">
				<AsideCard title="Source">
					<p className="m-0 break-all font-mono text-caption text-secondary">{skill.dir}</p>
					{detail.pluginId !== undefined && (
						<CustomizeLink
							target={{kind: "list", section: "plugins", search: {q: skill.sourceLabel}}}
							className="w-fit text-body text-accent-100 hover:underline"
						>
							{skill.sourceLabel}
						</CustomizeLink>
					)}
				</AsideCard>
				<AsideCard title="Invocation">
					<code className="font-mono text-body text-primary">
						{invocation}
						{detail.argumentHint === undefined ? "" : ` ${detail.argumentHint}`}
					</code>
					<dl className="m-0 flex flex-col gap-1">
						<Fact label="User-invocable" value={detail.userInvocable ? "Yes" : "No"} />
						<Fact label="Model-invocable" value={detail.modelInvocable ? "Yes" : "No"} />
					</dl>
				</AsideCard>
				<AsideCard title="Allowed tools">
					{detail.allowedTools.length === 0 ? (
						<p className="m-0 text-body text-secondary">Not restricted</p>
					) : (
						<ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
							{detail.allowedTools.map((tool) => (
								<li
									key={tool}
									className="rounded-r4 border border-border px-1.5 py-0.5 font-mono text-caption text-secondary"
								>
									{tool}
								</li>
							))}
						</ul>
					)}
				</AsideCard>
			</aside>
		</div>
	);
}
