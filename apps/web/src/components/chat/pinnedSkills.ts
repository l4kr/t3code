import type { ServerProviderSkill } from "@t3tools/contracts";
import {
  dedupeProviderSkillsByName,
  isProviderSkillUserInvocable,
} from "@t3tools/client-runtime/providerSkills";
import { formatProviderSkillDisplayName } from "@t3tools/shared/inlineSkills";
import * as Schema from "effect/Schema";

export const PINNED_SKILLS_STORAGE_KEY = "t3code:fork:pinned-skills:v2";
export const PinnedSkills = Schema.Array(
  Schema.Struct({ name: Schema.String, background: Schema.optional(Schema.Boolean) }),
);
export type PinnedSkill = (typeof PinnedSkills.Type)[number];
export const NO_PINNED_SKILLS: ReadonlyArray<PinnedSkill> = [];

const key = (name: string) => name.trim().toLowerCase();

export function pickableSkills(
  skills: ReadonlyArray<ServerProviderSkill>,
): ReadonlyArray<ServerProviderSkill> {
  return dedupeProviderSkillsByName(skills.filter(isProviderSkillUserInvocable)).toSorted((a, b) =>
    formatProviderSkillDisplayName(a).localeCompare(formatProviderSkillDisplayName(b)),
  );
}

export function resolvePinnedSkills(
  pinned: ReadonlyArray<PinnedSkill>,
  skills: ReadonlyArray<ServerProviderSkill>,
): ReadonlyArray<{ skill: ServerProviderSkill; background: boolean }> {
  const byName = new Map(pickableSkills(skills).map((skill) => [key(skill.name), skill]));
  return pinned.flatMap((entry) => {
    const skill = byName.get(key(entry.name));
    return skill ? [{ skill, background: entry.background === true }] : [];
  });
}

export function togglePinnedSkill(
  pinned: ReadonlyArray<PinnedSkill>,
  name: string,
  pin: boolean,
): ReadonlyArray<PinnedSkill> {
  const rest = pinned.filter((entry) => key(entry.name) !== key(name));
  if (!pin) return rest;
  return rest.length === pinned.length ? [...pinned, { name }] : pinned;
}

export function setPinnedSkillBackground(
  pinned: ReadonlyArray<PinnedSkill>,
  name: string,
  background: boolean,
): ReadonlyArray<PinnedSkill> {
  return pinned.map((entry) => {
    if (key(entry.name) !== key(name)) return entry;
    return background ? { ...entry, background } : { name: entry.name };
  });
}
