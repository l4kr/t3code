import * as Effect from "effect/Effect";

import type * as GitVcsDriver from "./vcs/GitVcsDriver.ts";

type Git = GitVcsDriver.GitVcsDriver["Service"];

const OPERATION = "StorageCleanup.deleteIntegratedBranch";

const integrationTargets = Effect.fn("StorageCleanup.integrationTargets")(function* (
  git: Git,
  cwd: string,
) {
  const targets: string[] = [];
  const remotes = yield* git.execute({ operation: OPERATION, cwd, args: ["remote"] });
  if (remotes.stdout.trim() !== "") {
    const remote = yield* git.resolvePrimaryRemoteName(cwd);
    const branch = yield* git.resolveDefaultBranchName(cwd, remote);
    if (branch !== null) targets.push(`refs/remotes/${remote}/${branch}`);
  }
  const head = yield* git.execute({
    operation: OPERATION,
    cwd,
    args: ["symbolic-ref", "--quiet", "HEAD"],
    allowNonZeroExit: true,
  });
  if (head.exitCode === 0) targets.push(head.stdout.trim());
  return targets;
});

export const deleteIntegratedBranch = Effect.fn(OPERATION)(function* (
  git: Git,
  input: { readonly cwd: string; readonly branch: string; readonly pullRequestMerged: boolean },
) {
  const ref = `refs/heads/${input.branch}`;
  const tip = yield* git.resolveCommit({ cwd: input.cwd, revision: ref });
  let integrated = input.pullRequestMerged;
  for (const target of integrated ? [] : yield* integrationTargets(git, input.cwd)) {
    if (target === ref) continue;
    const ancestor = yield* git.execute({
      operation: OPERATION,
      cwd: input.cwd,
      args: ["merge-base", "--is-ancestor", tip.commitSha, target],
      allowNonZeroExit: true,
    });
    if (ancestor.exitCode === 0) {
      integrated = true;
      break;
    }
  }
  if (!integrated) return false;
  yield* git.deleteLocalBranch({ cwd: input.cwd, refName: input.branch, force: true });
  return true;
});
