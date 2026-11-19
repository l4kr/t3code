import { describe, expect, it } from "vite-plus/test";

import type { ServerProviderSkill } from "@t3tools/contracts";

import { pickableSkills, resolvePinnedSkills, togglePinnedSkill } from "./pinnedSkills";

function makeSkill(input: Partial<ServerProviderSkill> & Pick<ServerProviderSkill, "name">) {
  return {
    path: `/tmp/${input.name}/SKILL.md`,
    enabled: true,
    ...input,
  } satisfies ServerProviderSkill;
}

const names = (skills: ReadonlyArray<ServerProviderSkill>) => skills.map((skill) => skill.name);

describe("pinned skills", () => {
  const skills = [
    makeSkill({ name: "ship" }),
    makeSkill({ name: "merge", displayName: "Merge" }),
    makeSkill({ name: "ship", path: "/other/ship/SKILL.md" }),
    makeSkill({ name: "agent-only", userInvocable: false }),
    makeSkill({ name: "off", enabled: false }),
    makeSkill({ name: "code-review" }),
  ];

  it("offers each skill a user can invoke once, alphabetically", () => {
    expect(names(pickableSkills(skills))).toEqual(["code-review", "merge", "ship"]);
  });

  it("shows pinned skills in pin order and hides ones this agent cannot run", () => {
    expect(
      names(resolvePinnedSkills(["ship", "missing", "off", "agent-only", "Code-Review"], skills)),
    ).toEqual(["ship", "code-review"]);
  });

  it("pins at the end and unpins regardless of case", () => {
    expect(togglePinnedSkill(["ship"], "merge", true)).toEqual(["ship", "merge"]);
    expect(togglePinnedSkill(["ship", "merge"], "merge", true)).toEqual(["ship", "merge"]);
    expect(togglePinnedSkill(["Ship", "merge"], "ship", false)).toEqual(["merge"]);
  });
});
