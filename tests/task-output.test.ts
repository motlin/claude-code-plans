import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";

import {readTaskOutput} from "../src/lib/task-output";

const UID = 501;
const PROJECT = "-Users-fab-projects-fabricated-app";
const CLI_SESSION = "dc5296db-0000-4000-8000-00000000fab1";

let root: string;
let tasksDir: string;
let options: {roots: string[]; uid: number; projectId: string; maxBytes: number};

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "task-output-")));
	tasksDir = join(root, `claude-${UID}`, PROJECT, CLI_SESSION, "tasks");
	mkdirSync(tasksDir, {recursive: true});
	options = {roots: [root], uid: UID, projectId: PROJECT, maxBytes: 64 * 1024};
});

afterEach(() => {
	rmSync(root, {recursive: true, force: true});
});

describe("readTaskOutput", () => {
	it("returns a small output file whole", async () => {
		const file = join(tasksDir, "bfab1build.output");
		writeFileSync(file, "vite v8 building for production...\nbuilt in 1.2s\n");

		expect(await readTaskOutput(file, options)).toStrictEqual({
			status: "ok",
			output: "vite v8 building for production...\nbuilt in 1.2s\n",
			truncated: false,
		});
	});

	it("returns only the tail of a large file, starting at a whole line, flagged truncated", async () => {
		const file = join(tasksDir, "bfab1build.output");
		writeFileSync(file, "line1\nline2\nline3\n");

		expect(await readTaskOutput(file, {...options, maxBytes: 10})).toStrictEqual({
			status: "ok",
			output: "line3\n",
			truncated: true,
		});
	});

	it("reports a cleaned-up file as missing", async () => {
		expect(await readTaskOutput(join(tasksDir, "bfab1gone.output"), options)).toStrictEqual({status: "missing"});
	});

	it("refuses paths that do not match the CLI's task-output pattern for this session's project", async () => {
		const outside = join(root, "elsewhere.output");
		writeFileSync(outside, "secret");
		writeFileSync(join(tasksDir, "bfab1build.txt"), "secret");
		const otherProject = join(root, `claude-${UID}`, "-Users-fab-other", CLI_SESSION, "tasks");
		mkdirSync(otherProject, {recursive: true});
		writeFileSync(join(otherProject, "bfab1build.output"), "secret");
		const otherUser = join(root, "claude-502", PROJECT, CLI_SESSION, "tasks");
		mkdirSync(otherUser, {recursive: true});
		writeFileSync(join(otherUser, "bfab1build.output"), "secret");

		const results = await Promise.all(
			[
				outside,
				join(tasksDir, "bfab1build.txt"),
				join(otherProject, "bfab1build.output"),
				join(otherUser, "bfab1build.output"),
				"relative/tasks/bfab1build.output",
				`/etc/claude-${UID}/${PROJECT}/${CLI_SESSION}/tasks/bfab1build.output`,
			].map(async (file) => readTaskOutput(file, options)),
		);
		expect(results).toStrictEqual(Array.from({length: 6}, () => ({status: "refused"})));
	});

	it("refuses traversal out of the tasks directory", async () => {
		writeFileSync(join(root, "bfab1build.output"), "secret");
		const sneaky = `${tasksDir}/../../../../bfab1build.output`;
		const dotted = `${root}/claude-${UID}/${PROJECT}/../${PROJECT}/${CLI_SESSION}/tasks/./bfab1build.output`;

		expect([await readTaskOutput(sneaky, options), await readTaskOutput(dotted, options)]).toStrictEqual([
			{status: "refused"},
			{status: "refused"},
		]);
	});

	it("refuses a symlinked output file or a symlinked directory on the way to it", async () => {
		const secret = join(root, "secret.txt");
		writeFileSync(secret, "secret");
		symlinkSync(secret, join(tasksDir, "bfab1link.output"));
		const linkedSession = join(root, `claude-${UID}`, PROJECT, "dc5296db-0000-4000-8000-00000000fab2");
		const realDir = join(root, "real-tasks");
		mkdirSync(join(realDir, "tasks"), {recursive: true});
		writeFileSync(join(realDir, "tasks", "bfab1build.output"), "secret");
		symlinkSync(realDir, linkedSession);

		expect([
			await readTaskOutput(join(tasksDir, "bfab1link.output"), options),
			await readTaskOutput(join(linkedSession, "tasks", "bfab1build.output"), options),
		]).toStrictEqual([{status: "refused"}, {status: "refused"}]);
	});
});
