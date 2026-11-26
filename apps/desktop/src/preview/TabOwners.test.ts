import { assert, describe, it } from "@effect/vitest";

import { makeTabOwners } from "./TabOwners.ts";

describe("TabOwners", () => {
  it("closes a tab only when the last window holding it lets go", () => {
    const owners = makeTabOwners();
    owners.add("tab", 1);
    owners.add("tab", 2);
    assert.isFalse(owners.release("tab", 1));
    assert.isTrue(owners.release("tab", 2));
  });

  it("lets a tab move to a new window before the old one lets go, in either order", () => {
    const moveFirst = makeTabOwners();
    moveFirst.add("tab", 1);
    moveFirst.add("tab", 2);
    assert.isFalse(moveFirst.release("tab", 1));

    const releaseFirst = makeTabOwners();
    releaseFirst.add("tab", 1);
    assert.isTrue(releaseFirst.release("tab", 1));
    releaseFirst.add("tab", 2);
    assert.isTrue(releaseFirst.release("tab", 2));
  });

  it("closes a tab released by a window that never opened it, as before", () => {
    assert.isTrue(makeTabOwners().release("tab", 7));
  });

  it("returns the tabs a closed window was the last to hold", () => {
    const owners = makeTabOwners();
    owners.add("shared", 1);
    owners.add("shared", 2);
    owners.add("own", 2);
    assert.deepStrictEqual(owners.releaseWindow(2), ["own"]);
    assert.isTrue(owners.release("shared", 1));
  });
});
