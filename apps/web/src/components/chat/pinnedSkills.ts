import type { ServerProviderSkill } from "@t3tools/contracts";
import {
  dedupeProviderSkillsByName,
  isProviderSkillUserInvocable,
} from "@t3tools/client-runtime/providerSkills";
import { formatProviderSkillDisplayName } from "@t3tools/shared/inlineSkills";
import * as Schema from "effect/Schema";

export const PINNED_SKILLS_STORAGE_KEY = "t3code:fork:pinned-skills:v1";
export const PinnedSkillNames = Schema.Array(Schema.String);
export const NO_PINNED_SKILLS: ReadonlyArray<string> = [];

const key = (name: string) => name.trim().toLowerCase();

export function pickableSkills(
  skills: ReadonlyArray<ServerProviderSkill>,
): ReadonlyArray<ServerProviderSkill> {
  return dedupeProviderSkillsByName(skills.filter(isProviderSkillUserInvocable)).toSorted((a, b) =>
    formatProviderSkillDisplayName(a).localeCompare(formatProviderSkillDisplayName(b)),
  );
}

export function resolvePinnedSkills(
  pinned: ReadonlyArray<string>,
  skills: ReadonlyArray<ServerProviderSkill>,
): ReadonlyArray<ServerProviderSkill> {
  const byName = new Map(pickableSkills(skills).map((skill) => [key(skill.name), skill]));
  return pinned.flatMap((name) => byName.get(key(name)) ?? []);
}

export function togglePinnedSkill(
  pinned: ReadonlyArray<string>,
  name: string,
  pin: boolean,
): ReadonlyArray<string> {
  const rest = pinned.filter((entry) => key(entry) !== key(name));
  if (!pin) return rest;
  return rest.length === pinned.length ? [...pinned, name] : pinned;
}
