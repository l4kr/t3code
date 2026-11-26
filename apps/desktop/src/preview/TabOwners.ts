export function makeTabOwners() {
  const owners = new Map<string, Set<number>>();
  return {
    add: (tabId: string, windowId: number) => {
      const current = owners.get(tabId) ?? new Set<number>();
      current.add(windowId);
      owners.set(tabId, current);
    },
    release: (tabId: string, windowId: number): boolean => {
      const current = owners.get(tabId);
      current?.delete(windowId);
      if (current && current.size > 0) return false;
      owners.delete(tabId);
      return true;
    },
    releaseWindow: (windowId: number): string[] => {
      const orphaned: string[] = [];
      for (const [tabId, current] of owners) {
        if (!current.delete(windowId) || current.size > 0) continue;
        owners.delete(tabId);
        orphaned.push(tabId);
      }
      return orphaned;
    },
  };
}

export const tabOwners = makeTabOwners();
