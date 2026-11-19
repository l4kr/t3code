import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

interface ThreadRef {
  readonly environmentId: string;
  readonly id: string;
}

interface SidebarOrder<Thread extends ThreadRef> {
  readonly orderedThreadKeys: ReadonlyArray<string>;
  readonly threadByKey: ReadonlyMap<string, Thread>;
  readonly sectionByThreadKey: ReadonlyMap<string, string>;
}

type SidebarThread = { readonly environmentId: EnvironmentId; readonly id: ThreadId };

let latest: SidebarOrder<SidebarThread> | null = null;

export function publishSidebarOrder(order: SidebarOrder<SidebarThread>): void {
  latest = order;
}

export function pickTopUnpinnedThread<Thread extends ThreadRef>(
  order: SidebarOrder<Thread> | null,
  exclude: ThreadRef,
): Thread | null {
  if (!order) return null;
  for (const key of order.orderedThreadKeys) {
    if (order.sectionByThreadKey.get(key) === "pinned") continue;
    const thread = order.threadByKey.get(key);
    if (!thread) continue;
    if (thread.environmentId === exclude.environmentId && thread.id === exclude.id) continue;
    return thread;
  }
  return null;
}

export function topUnpinnedSidebarThread(exclude: ThreadRef): SidebarThread | null {
  return pickTopUnpinnedThread(latest, exclude);
}
