import type { EnvironmentId, ServerProviderSkill, ThreadId } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { LayersIcon, PlusIcon, ZapIcon } from "lucide-react";
import { useRef, useState } from "react";

import { useAssetUrlState } from "../../assets/assetUrls";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { searchProviderSkills } from "../../providerSkillSearch";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSearchInput,
  MenuTrigger,
} from "../ui/menu";
import {
  NO_PINNED_SKILLS,
  NO_SKILL_ICONS,
  PINNED_SKILLS_STORAGE_KEY,
  PinnedSkills,
  SKILL_ICONS_STORAGE_KEY,
  SkillIcons,
  chosenSkillIcon,
  pickableSkills,
  resolvePinnedSkills,
  setPinnedSkillBackground,
  setSkillIcon,
  skillIconFilePath,
  skillLabel,
  togglePinnedSkill,
} from "./pinnedSkills";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";

const SKILL_ICON_SIZE = 64;

function SkillIcon({
  environmentId,
  threadId,
  skill,
  chosen,
  background,
  rescannedAt,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  skill: ServerProviderSkill;
  chosen: string | null;
  background: boolean;
  rescannedAt: string | undefined;
}) {
  const asset = useAssetUrlState(
    chosen === null ? environmentId : null,
    chosen === null ? { _tag: "media-file", threadId, path: skillIconFilePath(skill) } : null,
    rescannedAt ?? null,
  );
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = chosen ?? (asset._tag === "Success" ? asset.url : null);
  if (url === null || url === failedUrl) {
    const Icon = background ? LayersIcon : ZapIcon;
    return <Icon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />;
  }
  return (
    <span className="relative size-4 shrink-0" aria-hidden>
      <img
        src={url}
        alt=""
        draggable={false}
        className="size-full rounded-sm object-contain"
        onError={() => setFailedUrl(url)}
      />
      {background && (
        <LayersIcon className="absolute -right-1 -bottom-1 size-2.5 rounded-xs bg-background text-muted-foreground" />
      )}
    </span>
  );
}

async function readIconFile(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = SKILL_ICON_SIZE;
  canvas.height = SKILL_ICON_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  const scale = Math.min(SKILL_ICON_SIZE / bitmap.width, SKILL_ICON_SIZE / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    bitmap,
    (SKILL_ICON_SIZE - width) / 2,
    (SKILL_ICON_SIZE - height) / 2,
    width,
    height,
  );
  bitmap.close();
  return canvas.toDataURL("image/png");
}

export function ThreadDetailsSkills({
  environmentId,
  threadId,
  skills,
  rescannedAt,
  onUseSkill,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  skills: ReadonlyArray<ServerProviderSkill>;
  rescannedAt?: string | undefined;
  onUseSkill: (skill: ServerProviderSkill, background: boolean) => void;
}) {
  const gt = useGT();
  const [pinned, setPinned] = useLocalStorage(
    PINNED_SKILLS_STORAGE_KEY,
    NO_PINNED_SKILLS,
    PinnedSkills,
  );
  const [icons, setIcons] = useLocalStorage(SKILL_ICONS_STORAGE_KEY, NO_SKILL_ICONS, SkillIcons);
  const iconInput = useRef<HTMLInputElement>(null);
  const iconTarget = useRef<string | null>(null);
  const [query, setQuery] = useState("");
  const [rowMenu, setRowMenu] = useState<{
    name: string;
    background: boolean;
    x: number;
    y: number;
  } | null>(null);
  const shown = resolvePinnedSkills(pinned, skills);
  const options = query.trim() ? searchProviderSkills(skills, query) : pickableSkills(skills);
  const pinnedNames = new Set(shown.map(({ skill }) => skill.name));

  if (shown.length === 0 && pickableSkills(skills).length === 0) return null;

  return (
    <ThreadDetailsSection
      headingId="thread-details-skills-heading"
      title={gt("Skills")}
      showHeading={false}
    >
      <div className="flex flex-col">
        {shown.map(({ skill, background }) => {
          return (
            <ThreadDetailsControl
              key={skill.name}
              size="sm"
              variant="ghost"
              part="row"
              title={skill.shortDescription ?? skill.description}
              onClick={() => onUseSkill(skill, background)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setRowMenu({ name: skill.name, background, x: event.clientX, y: event.clientY });
              }}
            >
              <SkillIcon
                environmentId={environmentId}
                threadId={threadId}
                skill={skill}
                chosen={chosenSkillIcon(icons, skill.name)}
                background={background}
                rescannedAt={rescannedAt}
              />
              <span className={cn("min-w-0 truncate", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
                {skillLabel(skill)}
              </span>
            </ThreadDetailsControl>
          );
        })}
        <Menu onOpenChange={(open) => !open && setQuery("")}>
          <MenuTrigger
            render={<ThreadDetailsControl size="sm" variant="ghost" part="row" tone="muted" />}
          >
            <PlusIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
            <span className={cn("min-w-0 truncate", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
              {gt("Pick skills")}
            </span>
          </MenuTrigger>
          <MenuPopup align="start" className="w-72">
            <MenuSearchInput
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={gt("Search skills")}
              aria-label={gt("Search skills")}
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
                <span className="block truncate">{skillLabel(skill)}</span>
              </MenuCheckboxItem>
            ))}
          </MenuPopup>
        </Menu>
        <Menu open={rowMenu !== null} onOpenChange={(open) => !open && setRowMenu(null)}>
          <MenuPopup
            anchor={
              rowMenu
                ? { getBoundingClientRect: () => new DOMRect(rowMenu.x, rowMenu.y, 0, 0) }
                : undefined
            }
            align="start"
            side="bottom"
          >
            <MenuCheckboxItem
              checked={rowMenu?.background ?? false}
              onCheckedChange={(checked) => {
                if (!rowMenu) return;
                setPinned((current) => setPinnedSkillBackground(current, rowMenu.name, checked));
                setRowMenu({ ...rowMenu, background: checked });
              }}
            >
              {gt("Start in background")}
            </MenuCheckboxItem>
            <MenuItem
              onClick={() => {
                if (!rowMenu) return;
                iconTarget.current = rowMenu.name;
                iconInput.current?.click();
              }}
            >
              {gt("Change icon")}
            </MenuItem>
            {rowMenu && chosenSkillIcon(icons, rowMenu.name) !== null && (
              <MenuItem
                onClick={() => setIcons((current) => setSkillIcon(current, rowMenu.name, null))}
              >
                {gt("Reset icon")}
              </MenuItem>
            )}
            <MenuItem
              onClick={() => {
                if (!rowMenu) return;
                setPinned((current) => togglePinnedSkill(current, rowMenu.name, false));
              }}
            >
              {gt("Unpin")}
            </MenuItem>
          </MenuPopup>
        </Menu>
        <input
          ref={iconInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            const name = iconTarget.current;
            event.currentTarget.value = "";
            if (!file || !name) return;
            void readIconFile(file).then(
              (dataUrl) => setIcons((current) => setSkillIcon(current, name, dataUrl)),
              () => undefined,
            );
          }}
        />
      </div>
    </ThreadDetailsSection>
  );
}
