import { Link } from "@tanstack/react-router";
import { ArrowLeft, Scroll } from "lucide-react";
import type { ReactNode } from "react";
import type { SkillDetail } from "../../lib/api/customize";
import { Switch } from "../settings/switch";
import { countContentsFiles } from "./contents-order";
import { ShortDate } from "./customize-list";
import { IconTile } from "./icon-tile";
import { SkillRowActions } from "./skill-row-actions";
import { skillInvocation } from "./skills-view";

const TAB_CLASS =
  "relative inline-flex h-10 items-center gap-1 border-b-2 border-transparent px-1 text-body font-medium text-t6 no-underline hover:text-secondary aria-[current=page]:border-primary aria-[current=page]:text-primary";

/**
 * Upstream skill detail header: back link, 44px tile, H2 + "from <source> ·
 * updated <date>", the Enable switch, the kebab, then the underline
 * Overview · Contents · N tabs. The switch mirrors `skillOverrides` read-only.
 */
export function SkillDetailHeader({ detail }: { detail: SkillDetail }) {
  const { skill } = detail;
  return (
    <header className="flex flex-col gap-4">
      <Link
        to="/customize/skills"
        className="inline-flex w-fit items-center gap-1.5 rounded-r6 px-2 py-1 -ms-2 text-body text-secondary no-underline hover:bg-fill-ghost-hover hover:text-primary"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Your skills
      </Link>
      <div className="flex items-center gap-3">
        <IconTile icon={Scroll} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="m-0 truncate text-[20px]/[28px] font-medium text-primary">{skill.name}</h2>
          <p className="m-0 text-[13px]/[17px] text-t6">
            from {skill.sourceLabel} · updated <ShortDate ms={skill.mtime} />
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Switch
            aria-label="Enable skill"
            checked={skill.enabled}
            disabled
            onCheckedChange={() => {}}
          />
          <SkillRowActions skill={skill} triggerLabel={`More options for ${skill.name}`} />
        </div>
      </div>
      <nav aria-label="Skill sections" className="flex gap-4 border-b border-border">
        <Link
          to="/customize/skills/id/$skillId"
          params={{ skillId: skill.id }}
          activeOptions={{ exact: true }}
          className={TAB_CLASS}
        >
          Overview
        </Link>
        <Link
          to="/customize/skills/id/$skillId/contents"
          params={{ skillId: skill.id }}
          className={TAB_CLASS}
        >
          Contents <span className="text-t6">· {countContentsFiles(detail.tree)}</span>
        </Link>
      </nav>
    </header>
  );
}

function AsideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-card border border-border bg-surface-0 p-4">
      <h3 className="m-0 text-caption font-medium text-t6">{title}</h3>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-body">
      <dt className="text-secondary">{label}</dt>
      <dd className="m-0 text-primary">{value}</dd>
    </div>
  );
}

/** Overview tab: the full description beside Source, Invocation and Allowed tools cards. */
export function SkillOverview({ detail }: { detail: SkillDetail }) {
  const { skill } = detail;
  const invocation = skillInvocation(skill);
  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <section className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="m-0 text-caption font-medium text-t6">Description</h3>
        <p
          data-testid="skill-description"
          className="m-0 whitespace-pre-wrap text-body text-primary"
        >
          {skill.description === "" ? "No description." : skill.description}
        </p>
      </section>
      <aside className="flex w-full shrink-0 flex-col gap-3 md:w-60">
        <AsideCard title="Source">
          <p className="m-0 break-all font-mono text-caption text-secondary">{skill.dir}</p>
          {detail.pluginId !== undefined && (
            <Link
              to="/customize/plugins"
              search={{ q: skill.sourceLabel }}
              className="w-fit text-body text-accent-100 hover:underline"
            >
              {skill.sourceLabel}
            </Link>
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
