import {readdir, readFile} from "node:fs/promises";
import {join} from "node:path";
import {JobStateFileSchema, parseJobTimeline, sortJobs, toJob, type Job} from "./jobs";

async function readJob(jobsDir: string, id: string): Promise<Job | null> {
	let stateRaw: string;
	try {
		stateRaw = await readFile(join(jobsDir, id, "state.json"), "utf-8");
	} catch {
		return null;
	}
	try {
		const state = JobStateFileSchema.parse(JSON.parse(stateRaw));
		let timelineRaw = "";
		try {
			timelineRaw = await readFile(join(jobsDir, id, "timeline.jsonl"), "utf-8");
		} catch {
			// Jobs reaped before their first transition have no timeline.
		}
		return toJob(id, state, parseJobTimeline(timelineRaw));
	} catch (error) {
		console.warn(`Skipping background job ${id}:`, error);
		return null;
	}
}

/** Read every `~/.claude/jobs/<short>/` job from disk, newest first. */
export async function readJobs(jobsDir: string): Promise<Job[]> {
	let entries;
	try {
		entries = await readdir(jobsDir, {withFileTypes: true});
	} catch {
		return [];
	}
	const jobs = await Promise.all(
		entries.filter((entry) => entry.isDirectory()).map((entry) => readJob(jobsDir, entry.name)),
	);
	return sortJobs(jobs.filter((job): job is Job => job !== null));
}
