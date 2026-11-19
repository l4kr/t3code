import type { ServerProviderSkill } from "@t3tools/contracts";
import {
  dedupeProviderSkillsByName,
  isProviderSkillUserInvocable,
} from "@t3tools/client-runtime/providerSkills";
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
    skillLabel(a).localeCompare(skillLabel(b)),
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

const UPPERCASE_WORDS = new Set([
  "ai",
  "api",
  "ci",
  "cli",
  "css",
  "html",
  "id",
  "llm",
  "mcp",
  "pdf",
  "pr",
  "sql",
  "ui",
  "url",
  "ux",
]);

export function skillLabel(skill: Pick<ServerProviderSkill, "name" | "displayName">): string {
  const displayName = skill.displayName?.trim();
  if (displayName) return displayName;
  const words = (skill.name.split(":").at(-1) ?? skill.name).split(/[-_\s]+/).filter(Boolean);
  if (words.length === 0) return skill.name;
  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (UPPERCASE_WORDS.has(lower)) return lower.toUpperCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

export function skillIconFilePath(skill: Pick<ServerProviderSkill, "path">): string {
  const end = Math.max(skill.path.lastIndexOf("/"), skill.path.lastIndexOf("\\"));
  const separator = skill.path.charAt(end) || "/";
  return `${skill.path.slice(0, end)}${separator}icon.png`;
}

export const SKILL_ICONS_STORAGE_KEY = "t3code:fork:skill-icons:v1";
export const SkillIcons = Schema.Record(Schema.String, Schema.String);
export type SkillIcons = typeof SkillIcons.Type;
export const NO_SKILL_ICONS: SkillIcons = {};

export function chosenSkillIcon(icons: SkillIcons, name: string): string | null {
  return icons[key(name)] ?? null;
}

export function setSkillIcon(icons: SkillIcons, name: string, dataUrl: string | null): SkillIcons {
  const { [key(name)]: _previous, ...rest } = icons;
  return dataUrl === null ? rest : { ...rest, [key(name)]: dataUrl };
}
