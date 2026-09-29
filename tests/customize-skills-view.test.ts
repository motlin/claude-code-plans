import { describe, expect, it } from "vite-plus/test";
import {
  filterSkills,
  groupSkills,
  skillInvocation,
  sortSkills,
} from "../src/components/customize/skills-view";
import type { SkillSummary } from "../src/lib/api/customize";

function skill(
  overrides: Partial<SkillSummary> & Pick<SkillSummary, "id" | "name" | "source">,
): SkillSummary {
  return {
    description: `${overrides.name} description`,
    sourceLabel: "Personal",
    dir: `/skills/${overrides.name}`,
    mtime: 0,
    enabled: true,
    ...overrides,
  };
}

const DEPLOY = skill({
  id: "personal:deploy",
  name: "deploy",
  source: "personal",
  description: "Ship the release",
  mtime: 300,
});
const AUDIT = skill({ id: "personal:audit", name: "audit", source: "personal", mtime: 100 });
const WEB_LINT = skill({
  id: "project:-Users-me-web:lint",
  name: "lint",
  source: "project",
  sourceLabel: "web",
  mtime: 200,
});
const API_LINT = skill({
  id: "project:-Users-me-api:lint",
  name: "lint",
  source: "project",
  sourceLabel: "api",
  mtime: 50,
});
const PDF = skill({
  id: "plugin:document-skills@anthropic:pdf",
  name: "pdf",
  source: "plugin",
  sourceLabel: "document-skills",
  mtime: 400,
});
const DOCX = skill({
  id: "plugin:document-skills@anthropic:docx",
  name: "docx",
  source: "plugin",
  sourceLabel: "document-skills",
  mtime: 10,
});

const ALL = [PDF, WEB_LINT, DEPLOY, DOCX, API_LINT, AUDIT];

const ids = (skills: readonly SkillSummary[]) => skills.map((entry) => entry.id);

describe("groupSkills", () => {
  it("orders Personal, then each project by name, then From plugins", () => {
    expect(
      groupSkills(ALL).map((group) => ({
        key: group.key,
        title: group.title,
        ids: ids(group.skills),
      })),
    ).toStrictEqual([
      { key: "personal", title: "Personal", ids: ["personal:deploy", "personal:audit"] },
      { key: "project:-Users-me-api", title: "Project · api", ids: ["project:-Users-me-api:lint"] },
      { key: "project:-Users-me-web", title: "Project · web", ids: ["project:-Users-me-web:lint"] },
      {
        key: "plugin",
        title: "From plugins",
        ids: ["plugin:document-skills@anthropic:pdf", "plugin:document-skills@anthropic:docx"],
      },
    ]);
  });

  it("omits groups that have no skills", () => {
    expect(groupSkills([PDF]).map((group) => group.title)).toStrictEqual(["From plugins"]);
  });
});

describe("sortSkills", () => {
  it("sorts by last edited, newest first, by default", () => {
    expect(ids(sortSkills(ALL, "edited"))).toStrictEqual([
      "plugin:document-skills@anthropic:pdf",
      "personal:deploy",
      "project:-Users-me-web:lint",
      "personal:audit",
      "project:-Users-me-api:lint",
      "plugin:document-skills@anthropic:docx",
    ]);
  });

  it("sorts by name, breaking ties by source label", () => {
    expect(ids(sortSkills(ALL, "name"))).toStrictEqual([
      "personal:audit",
      "personal:deploy",
      "plugin:document-skills@anthropic:docx",
      "project:-Users-me-api:lint",
      "project:-Users-me-web:lint",
      "plugin:document-skills@anthropic:pdf",
    ]);
  });

  it("does not mutate its input", () => {
    const input = [AUDIT, DEPLOY];
    sortSkills(input, "name");
    expect(ids(input)).toStrictEqual(["personal:audit", "personal:deploy"]);
  });
});

describe("filterSkills", () => {
  it("keeps only the chosen source", () => {
    expect({
      all: ids(filterSkills(ALL, "all", undefined)),
      personal: ids(filterSkills(ALL, "personal", undefined)),
      project: ids(filterSkills(ALL, "project", "")),
      plugin: ids(filterSkills(ALL, "plugin", undefined)),
    }).toStrictEqual({
      all: ids(ALL),
      personal: ["personal:deploy", "personal:audit"],
      project: ["project:-Users-me-web:lint", "project:-Users-me-api:lint"],
      plugin: ["plugin:document-skills@anthropic:pdf", "plugin:document-skills@anthropic:docx"],
    });
  });

  it("matches the query against name, description and source label", () => {
    expect({
      description: ids(filterSkills(ALL, "all", "RELEASE")),
      label: ids(filterSkills(ALL, "all", "document")),
      combined: ids(filterSkills(ALL, "project", "api")),
    }).toStrictEqual({
      description: ["personal:deploy"],
      label: ["plugin:document-skills@anthropic:pdf", "plugin:document-skills@anthropic:docx"],
      combined: ["project:-Users-me-api:lint"],
    });
  });
});

describe("skillInvocation", () => {
  it("prefixes plugin skills with the plugin name", () => {
    expect([
      skillInvocation(DEPLOY),
      skillInvocation(WEB_LINT),
      skillInvocation(PDF),
    ]).toStrictEqual(["/deploy", "/lint", "/document-skills:pdf"]);
  });
});
