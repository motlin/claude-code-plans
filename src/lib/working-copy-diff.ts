import { execFile } from "node:child_process";

const MAX_GIT_OUTPUT_BYTES = 100 * 1024 * 1024;

function runGit(cwd: string, arguments_: string[], allowDifferences = false): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      arguments_,
      { cwd, encoding: "utf8", maxBuffer: MAX_GIT_OUTPUT_BYTES },
      (error, stdout) => {
        if (error && !(allowDifferences && error.code === 1)) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/** Build a unified diff for every tracked, staged, and untracked working-tree change. */
export async function buildWorkingCopyDiff(cwd: string): Promise<string> {
  const stablePrefixes = ["--src-prefix=a/", "--dst-prefix=b/"];
  const tracked = await runGit(cwd, ["diff", ...stablePrefixes, "HEAD"]);
  const untracked = await runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const parts = [tracked];

  for (const file of untracked.split("\0").filter(Boolean)) {
    parts.push(
      await runGit(cwd, ["diff", ...stablePrefixes, "--no-index", "--", "/dev/null", file], true),
    );
  }

  return parts.filter(Boolean).join("\n");
}
