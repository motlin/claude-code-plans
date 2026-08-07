import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectJsonlFiles,
  partitionIssues,
  selectFilesForScan,
  type JsonlFile,
} from "./jsonl-corpus";

describe("collectJsonlFiles", () => {
  it("collects session transcripts and the subagent transcripts nested beneath them", async () => {
    const projectsDirectory = await mkdtemp(join(tmpdir(), "jsonl-corpus-"));
    const projectDirectory = join(projectsDirectory, "-Users-craig-projects-demo");
    const subagentsDirectory = join(projectDirectory, "session-uuid", "subagents");
    await mkdir(subagentsDirectory, { recursive: true });
    await writeFile(join(projectDirectory, "session-uuid.jsonl"), "");
    await writeFile(join(subagentsDirectory, "agent-abc123.jsonl"), "");
    await writeFile(join(subagentsDirectory, "notes.md"), "");

    const collected = await collectJsonlFiles(projectsDirectory);

    expect({
      relativePaths: collected.files.map((file) => file.relativePath).sort(),
      skippedUnavailablePaths: collected.skippedUnavailablePaths,
    }).toStrictEqual({
      relativePaths: [
        "-Users-craig-projects-demo/session-uuid.jsonl",
        "-Users-craig-projects-demo/session-uuid/subagents/agent-abc123.jsonl",
      ],
      skippedUnavailablePaths: 0,
    });
  });

  it("ignores session directories without a subagents directory", async () => {
    const projectsDirectory = await mkdtemp(join(tmpdir(), "jsonl-corpus-"));
    const projectDirectory = join(projectsDirectory, "-Users-craig-projects-demo");
    await mkdir(join(projectDirectory, "session-uuid"), { recursive: true });
    await writeFile(join(projectDirectory, "session-uuid.jsonl"), "");

    const collected = await collectJsonlFiles(projectsDirectory);

    expect({
      relativePaths: collected.files.map((file) => file.relativePath),
      skippedUnavailablePaths: collected.skippedUnavailablePaths,
    }).toStrictEqual({
      relativePaths: ["-Users-craig-projects-demo/session-uuid.jsonl"],
      skippedUnavailablePaths: 0,
    });
  });

  it("returns nothing when the projects directory is absent", async () => {
    const collected = await collectJsonlFiles(join(tmpdir(), "jsonl-corpus-absent-directory"));

    expect(collected).toStrictEqual({ files: [], skippedUnavailablePaths: 0 });
  });
});

describe("selectFilesForScan", () => {
  const currentTimeMilliseconds = Date.parse("2000-01-03T00:00:00.000Z");
  const files: JsonlFile[] = [
    {
      path: "/tmp/test/alice-old.jsonl",
      relativePath: "alice/alice-old.jsonl",
      modifiedAtMilliseconds: Date.parse("1999-12-31T00:00:00.000Z"),
    },
    {
      path: "/tmp/test/bob-recent.jsonl",
      relativePath: "bob/bob-recent.jsonl",
      modifiedAtMilliseconds: Date.parse("2000-01-02T00:00:00.000Z"),
    },
    {
      path: "/tmp/test/alice-recent.jsonl",
      relativePath: "alice/alice-recent.jsonl",
      modifiedAtMilliseconds: Date.parse("2000-01-02T00:00:00.000Z"),
    },
    {
      path: "/tmp/test/charlie-newest.jsonl",
      relativePath: "charlie/charlie-newest.jsonl",
      modifiedAtMilliseconds: Date.parse("2000-01-03T00:00:00.000Z"),
    },
  ];

  it("selects recent files newest-first with a deterministic path tie-break and cap", () => {
    expect(selectFilesForScan(files, false, currentTimeMilliseconds, 2)).toStrictEqual({
      files: [files[3], files[2]],
      skippedForAge: 1,
      skippedForLimit: 1,
    });
  });

  it("selects every file newest-first for a full scan", () => {
    expect(selectFilesForScan(files, true, currentTimeMilliseconds, 2)).toStrictEqual({
      files: [files[3], files[2], files[1], files[0]],
      skippedForAge: 0,
      skippedForLimit: 0,
    });
  });
});

describe("partitionIssues", () => {
  it("classifies tool-input mismatches separately from record-shape drift", () => {
    expect(
      partitionIssues([
        { path: ["message", "content", "0", "input"], message: 'Unrecognized key: "path"' },
        { path: ["message", "content", "12", "input", "-n"], message: "expected boolean" },
      ]),
    ).toStrictEqual({
      recordIssues: [],
      toolInputIssues: [
        'message.content.0.input: Unrecognized key: "path"',
        "message.content.12.input.-n: expected boolean",
      ],
    });
  });

  it("treats an unknown top-level key as record-shape drift", () => {
    expect(
      partitionIssues([{ path: [], message: 'Unrecognized key: "attributionAgent"' }]),
    ).toStrictEqual({
      recordIssues: ['Unrecognized key: "attributionAgent"'],
      toolInputIssues: [],
    });
  });

  it("treats a record with any shape issue as drift even alongside input issues", () => {
    expect(
      partitionIssues([
        { path: ["message", "content", "0", "input"], message: 'Unrecognized key: "path"' },
        { path: ["attachment", "type"], message: "Invalid discriminator value" },
      ]),
    ).toStrictEqual({
      recordIssues: ["attachment.type: Invalid discriminator value"],
      toolInputIssues: ['message.content.0.input: Unrecognized key: "path"'],
    });
  });

  it("does not mistake a message field named input for a tool input", () => {
    expect(partitionIssues([{ path: ["message", "input"], message: "nope" }])).toStrictEqual({
      recordIssues: ["message.input: nope"],
      toolInputIssues: [],
    });
  });
});
