import type { EnvironmentId, ServerProviderSkill, ThreadId } from "@t3tools/contracts";

import { topUnpinnedSidebarThread } from "./sidebarTopThread";

type ThreadRef = { readonly environmentId: EnvironmentId; readonly id: ThreadId };

export async function runPinnedSkill(input: {
  skill: ServerProviderSkill;
  background: boolean;
  composer: {
    insertTextAtEnd: (text: string, options?: { ensureLeadingBoundary?: boolean }) => boolean;
    readSnapshot: () => { value: string };
  } | null;
  send: (
    event: undefined,
    dispatchMode: "auto",
    intent: "foreground" | "background",
  ) => Promise<unknown>;
  from: ThreadRef;
  openThread: (thread: ThreadRef) => void;
}): Promise<void> {
  const token = `$${input.skill.name}`;
  if (!input.composer?.insertTextAtEnd(`${token} `, { ensureLeadingBoundary: true })) return;
  await input.send(undefined, "auto", input.background ? "background" : "foreground");
  if (!input.background || input.composer.readSnapshot().value.includes(token)) return;
  const next = topUnpinnedSidebarThread(input.from);
  if (next) input.openThread(next);
}
