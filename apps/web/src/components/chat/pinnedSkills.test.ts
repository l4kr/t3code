import { describe, expect, it } from "vite-plus/test";

import type { ServerProviderSkill } from "@t3tools/contracts";

import {
  pickableSkills,
  resolvePinnedSkills,
  setPinnedSkillBackground,
  togglePinnedSkill,
} from "./pinnedSkills";

function makeSkill(input: Partial<ServerProviderSkill> & Pick<ServerProviderSkill, "name">) {
  return {
    path: `/tmp/${input.name}/SKILL.md`,
    enabled: true,
    ...input,
  } satisfies ServerProviderSkill;
}

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
    expect(pickableSkills(skills).map((skill) => skill.name)).toEqual([
      "code-review",
      "merge",
      "ship",
    ]);
  });

  it("shows pinned skills in pin order with their start mode, hiding ones this agent cannot run", () => {
    const pinned = [
      { name: "ship", background: true },
      { name: "missing" },
      { name: "off" },
      { name: "agent-only" },
      { name: "Code-Review" },
    ];
    expect(
      resolvePinnedSkills(pinned, skills).map(({ skill, background }) => [skill.name, background]),
    ).toEqual([
      ["ship", true],
      ["code-review", false],
    ]);
  });

  it("pins at the end and unpins regardless of case", () => {
    expect(togglePinnedSkill([{ name: "ship" }], "merge", true)).toEqual([
      { name: "ship" },
      { name: "merge" },
    ]);
    const pinned = [{ name: "ship" }, { name: "merge", background: true }];
    expect(togglePinnedSkill(pinned, "merge", true)).toBe(pinned);
    expect(togglePinnedSkill([{ name: "Ship" }, { name: "merge" }], "ship", false)).toEqual([
      { name: "merge" },
    ]);
  });

  it("switches one skill between foreground and background", () => {
    const pinned = [{ name: "ship" }, { name: "merge" }];
    expect(setPinnedSkillBackground(pinned, "SHIP", true)).toEqual([
      { name: "ship", background: true },
      { name: "merge" },
    ]);
    expect(setPinnedSkillBackground([{ name: "ship", background: true }], "ship", false)).toEqual([
      { name: "ship" },
    ]);
  });
});
