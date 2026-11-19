import type { ServerProviderSkill } from "@t3tools/contracts";
import { formatProviderSkillDisplayName } from "@t3tools/shared/inlineSkills";
import { PlusIcon, ZapIcon } from "lucide-react";
import { useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { searchProviderSkills } from "../../providerSkillSearch";
import { Menu, MenuCheckboxItem, MenuPopup, MenuSearchInput, MenuTrigger } from "../ui/menu";
import {
  NO_PINNED_SKILLS,
  PINNED_SKILLS_STORAGE_KEY,
  PinnedSkillNames,
  pickableSkills,
  resolvePinnedSkills,
  togglePinnedSkill,
} from "./pinnedSkills";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";

export function ThreadDetailsSkills({
  skills,
  onUseSkill,
}: {
  skills: ReadonlyArray<ServerProviderSkill>;
  onUseSkill: (skill: ServerProviderSkill) => void;
}) {
  const [pinned, setPinned] = useLocalStorage(
    PINNED_SKILLS_STORAGE_KEY,
    NO_PINNED_SKILLS,
    PinnedSkillNames,
  );
  const [query, setQuery] = useState("");
  const shown = resolvePinnedSkills(pinned, skills);
  const options = query.trim() ? searchProviderSkills(skills, query) : pickableSkills(skills);
  const pinnedNames = new Set(shown.map((skill) => skill.name));

  if (shown.length === 0 && pickableSkills(skills).length === 0) return null;

  return (
    <ThreadDetailsSection
      headingId="thread-details-skills-heading"
      title="Skills"
      showHeading={false}
    >
      <div className="flex flex-col">
        {shown.map((skill) => (
          <ThreadDetailsControl
            key={skill.name}
            size="sm"
            variant="ghost"
            part="row"
            title={skill.shortDescription ?? skill.description}
            onClick={() => onUseSkill(skill)}
          >
            <ZapIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
            <span className={cn("min-w-0 truncate", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
              {formatProviderSkillDisplayName(skill)}
            </span>
          </ThreadDetailsControl>
        ))}
        <Menu onOpenChange={(open) => !open && setQuery("")}>
          <MenuTrigger
            render={<ThreadDetailsControl size="sm" variant="ghost" part="row" tone="muted" />}
          >
            <PlusIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
            <span className={cn("min-w-0 truncate", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
              Pick skills
            </span>
          </MenuTrigger>
          <MenuPopup align="start" className="w-72">
            <MenuSearchInput
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search skills"
              aria-label="Search skills"
            />
            {options.map((skill) => (
              <MenuCheckboxItem
                key={skill.name}
                checked={pinnedNames.has(skill.name)}
                closeOnClick={false}
                onCheckedChange={(checked) =>
                  setPinned((current) => togglePinnedSkill(current, skill.name, checked))
                }
              >
                <span className="block truncate">{formatProviderSkillDisplayName(skill)}</span>
              </MenuCheckboxItem>
            ))}
          </MenuPopup>
        </Menu>
      </div>
    </ThreadDetailsSection>
  );
}
