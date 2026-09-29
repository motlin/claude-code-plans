import type { SkillSummary } from "../api/customize";
import { getDb } from "../db";
import { listProjectsFromDb } from "../db/queries";
import { listSkills } from "./skills";

/** Every skill for the indexed projects (personal, project and plugin). */
export async function listIndexedSkills(): Promise<SkillSummary[]> {
  const projects = listProjectsFromDb(getDb().index).flatMap(({ id, projectPath }) =>
    projectPath === null ? [] : [{ id, projectPath }],
  );
  return listSkills({ projects });
}

export async function findIndexedSkill(id: string): Promise<SkillSummary | undefined> {
  return (await listIndexedSkills()).find((skill) => skill.id === id);
}
