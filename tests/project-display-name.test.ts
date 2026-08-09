import { describe, expect, it } from "vite-plus/test";
import {
  deriveProjectDisplayName,
  type KnownProjectName,
} from "../src/lib/project-display-name.js";

const workspaceRoots = ["/Users/craig", "/Users/craig/projects", "/tmp", "/private/tmp"];

const knownProjects: KnownProjectName[] = [
  { id: "-Users-craig", name: "craig", projectPath: "/Users/craig" },
  { id: "-Users-craig-projects", name: "projects", projectPath: "/Users/craig/projects" },
  { id: "-private-tmp", name: "tmp", projectPath: "/private/tmp" },
  {
    id: "-Users-craig-projects-eclipse-collections",
    name: "eclipse-collections",
    projectPath: "/Users/craig/projects/eclipse-collections",
  },
  {
    id: "-Users-craig-projects-liftwizard",
    name: "liftwizard",
    projectPath: "/Users/craig/projects/liftwizard",
  },
  {
    id: "-Users-craig-projects-workflowy",
    name: "workflowy",
    projectPath: "/Users/craig/projects/workflowy",
  },
  {
    id: "-Users-craig-projects-factorio-blueprint-playground",
    name: "factorio-blueprint-playground",
    projectPath: "/Users/craig/projects/factorio-blueprint-playground",
  },
  { id: "-Users-craig--dotfiles", name: ".dotfiles", projectPath: null },
];

const noDirectories = () => false;

function derive(encodedId: string, projectPath: string | null = null): string {
  return deriveProjectDisplayName(encodedId, projectPath, knownProjects, {
    workspaceRoots,
    directoryExists: noDirectories,
  });
}

describe("deriveProjectDisplayName", () => {
  it("maps encoded ids to meaningful unique display names", () => {
    const table: [string, string][] = [
      // Worktrees whose ".claude-worktrees" dot was encoded to a hyphen.
      [
        "-Users-craig-projects-liftwizard--claude-worktrees-String-format",
        "liftwizard/String-format",
      ],
      [
        "-Users-craig-projects-eclipse-collections--claude-worktrees-spotbugs",
        "eclipse-collections/spotbugs",
      ],
      // Newer encodings keep the dot in ".claude-worktrees".
      [
        "-Users-craig-projects-eclipse-collections-.claude-worktrees-add-jmh-to-gha-perf-job",
        "eclipse-collections/add-jmh-to-gha-perf-job",
      ],
      // Other worktree container conventions.
      [
        "-Users-craig-projects-factorio-blueprint-playground--llm-worktrees-transformations-codex",
        "factorio-blueprint-playground/transformations-codex",
      ],
      // Nested checkouts under a known project.
      ["-Users-craig-projects-eclipse-collections-merge-4", "eclipse-collections/merge-4"],
      ["-Users-craig-projects-eclipse-collections-build", "eclipse-collections/build"],
      ["-Users-craig-projects-liftwizard-pom-cleanup", "liftwizard/pom-cleanup"],
      // A known parent without a resolved path still qualifies.
      ["-Users-craig--dotfiles-rebase", ".dotfiles/rebase"],
      // Scratchpad sandbox under /private/tmp embeds the owning project's id.
      [
        "-private-tmp-claude-501--Users-craig-projects-workflowy-953cfed4-c1c7-46ee-82b4-cce5f276b425-scratchpad-sandbox-project",
        "workflowy/scratchpad-sandbox-project",
      ],
      // Ordinary projects keep the plain leaf name.
      ["-Users-craig-projects-myapp", "myapp"],
      ["-Users-craig-projects", "projects"],
      ["-Users-craig", "craig"],
    ];

    expect(table.map(([encoded]) => derive(encoded))).toStrictEqual(
      table.map(([, expected]) => expected),
    );
  });

  it("never produces purely numeric names for worktree-style ids", () => {
    const encodedIds = [1, 2, 3, 4, 5, 6].map(
      (n) => `-Users-craig-projects-eclipse-collections-merge-${n}`,
    );
    const names = encodedIds.map((encoded) => derive(encoded));
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => !/^\d+$/.test(name))).toBe(true);
  });

  it("derives worktree names from a real project path", () => {
    expect(
      derive(
        "-Users-craig-projects-liftwizard--claude-worktrees-String-format",
        "/Users/craig/projects/liftwizard/.claude-worktrees/String-format",
      ),
    ).toBe("liftwizard/String-format");
  });

  it("renders parent/worktree for a path nested inside a known project", () => {
    expect(
      derive(
        "-Users-craig-projects-eclipse-collections-merge-4",
        "/Users/craig/projects/eclipse-collections/merge-4",
      ),
    ).toBe("eclipse-collections/merge-4");
  });

  it("keeps the full leaf for a peer directory whose name extends a known project", () => {
    expect(
      derive("-Users-craig-projects-workflowy-java", "/Users/craig/projects/workflowy-java"),
    ).toBe("workflowy-java");
  });

  it("keeps the leaf for a plain project path", () => {
    expect(derive("-Users-craig-projects-my-app", "/Users/craig/projects/my-app")).toBe("my-app");
  });

  it("prefers the on-disk peer directory over a guessed nested checkout", () => {
    const name = deriveProjectDisplayName(
      "-Users-craig-projects-eclipse-collections-kata",
      null,
      knownProjects,
      {
        workspaceRoots,
        directoryExists: (path) => path === "/Users/craig/projects/eclipse-collections-kata",
      },
    );
    expect(name).toBe("eclipse-collections-kata");
  });

  it("falls back to the final encoded segment when nothing resolves", () => {
    expect(
      derive("-Users-craig-Library-Application-Support-iTerm2-iterm2env-3-10-19-versions"),
    ).toBe("versions");
  });
});
