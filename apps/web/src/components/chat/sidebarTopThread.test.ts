import { describe, expect, it } from "vite-plus/test";

import { pickTopUnpinnedThread } from "./sidebarTopThread";

const row = (id: string, section: string, environmentId = "env") => ({
  key: `${environmentId}:${id}`,
  thread: { environmentId, id },
  section,
});

function order(rows: ReadonlyArray<ReturnType<typeof row>>) {
  return {
    orderedThreadKeys: rows.map((entry) => entry.key),
    threadByKey: new Map(rows.map((entry) => [entry.key, entry.thread])),
    sectionByThreadKey: new Map(rows.map((entry) => [entry.key, entry.section])),
  };
}

describe("pickTopUnpinnedThread", () => {
  it("opens the highest thread below the pinned ones, never the one just started", () => {
    const sidebar = order([
      row("pinned-a", "pinned"),
      row("pinned-b", "pinned"),
      row("started", "active"),
      row("next", "active"),
      row("later", "settled"),
    ]);
    expect(pickTopUnpinnedThread(sidebar, { environmentId: "env", id: "started" })).toEqual({
      environmentId: "env",
      id: "next",
    });
  });

  it("treats the same thread id in another environment as a different thread", () => {
    const sidebar = order([row("t1", "active", "remote"), row("t1", "active")]);
    expect(pickTopUnpinnedThread(sidebar, { environmentId: "env", id: "t1" })).toEqual({
      environmentId: "remote",
      id: "t1",
    });
  });

  it("finds nothing when only pinned threads and the started one are listed", () => {
    const sidebar = order([row("pinned", "pinned"), row("started", "active")]);
    expect(pickTopUnpinnedThread(sidebar, { environmentId: "env", id: "started" })).toBeNull();
    expect(pickTopUnpinnedThread(null, { environmentId: "env", id: "started" })).toBeNull();
  });
});
