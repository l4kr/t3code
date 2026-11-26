import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { defaultStringifySearch } from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { surfaceWindowSearch } from "./surfaceWindow";
import {
  hostsBrowserTab,
  parseClaims,
  surfaceWindowTargetAt,
  withClaim,
  withoutClaim,
} from "./surfaceWindowRegistry";

const threadRef: ScopedThreadRef = {
  environmentId: "env-1" as EnvironmentId,
  threadId: "thread-1" as ThreadId,
};
const target = { threadRef, source: { kind: "browser", tabId: "tab-1" } } as const;
const backgroundTarget = { ...target, background: true } as const;
const query = defaultStringifySearch({
  surface: { ...surfaceWindowSearch(target), unfocused: "1" },
});

describe("surfaceWindowTargetAt", () => {
  it("reads the target from a web path and from desktop's hash route", () => {
    expect(surfaceWindowTargetAt({ pathname: "/surface", search: query, hash: "" })).toEqual(
      backgroundTarget,
    );
    expect(surfaceWindowTargetAt({ pathname: "/", search: "", hash: `#/surface${query}` })).toEqual(
      backgroundTarget,
    );
  });

  it("is null in the main window", () => {
    expect(surfaceWindowTargetAt({ pathname: "/env-1/thread-1", search: "", hash: "" })).toBeNull();
    expect(
      surfaceWindowTargetAt({ pathname: "/", search: "", hash: "#/env-1/thread-1" }),
    ).toBeNull();
  });
});

describe("browser tab hosting", () => {
  const claims = withClaim(parseClaims(null), target);

  it("hosts a tab only in its own window while that window is open", () => {
    expect(hostsBrowserTab({ kind: "surface", target }, claims, threadRef, "tab-1")).toBe(true);
    expect(hostsBrowserTab({ kind: "surface", target }, claims, threadRef, "tab-2")).toBe(false);
    expect(hostsBrowserTab({ kind: "main" }, claims, threadRef, "tab-1")).toBe(false);
    expect(hostsBrowserTab({ kind: "main" }, claims, threadRef, "tab-2")).toBe(true);
  });

  it("returns the tab to the main window when its window closes", () => {
    const released = withoutClaim(claims, target);
    expect(hostsBrowserTab({ kind: "main" }, released, threadRef, "tab-1")).toBe(true);
  });

  it("ignores unreadable stored claims", () => {
    expect(parseClaims("not json")).toEqual({});
    expect(parseClaims('{"x":1}')).toEqual({});
  });
});
