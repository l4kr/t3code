import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { defaultParseSearch } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";

import {
  SURFACE_WINDOW_PATH,
  parseSurfaceWindowSearch,
  surfaceWindowKey,
  type SurfaceWindowTarget,
} from "./surfaceWindow";

const STORAGE_KEY = "t3code:surface-windows";
const SESSION_KEY = "t3code:surface-windows-session";

export type Claims = Readonly<Record<string, string>>;

export type SurfaceWindowRole =
  | { readonly kind: "main" }
  | { readonly kind: "surface"; readonly target: SurfaceWindowTarget };

const browserTabKey = (threadRef: ScopedThreadRef, tabId: string) =>
  `${scopedThreadKey(threadRef)}|browser:${tabId}`;

export function parseClaims(raw: string | null): Claims {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

export function withClaim(claims: Claims, target: SurfaceWindowTarget): Claims {
  return { ...claims, [surfaceWindowKey(target)]: scopedThreadKey(target.threadRef) };
}

export function withoutClaim(claims: Claims, target: SurfaceWindowTarget): Claims {
  const { [surfaceWindowKey(target)]: _released, ...rest } = claims;
  return rest;
}

export function hostsBrowserTab(
  role: SurfaceWindowRole,
  claims: Claims,
  threadRef: ScopedThreadRef,
  tabId: string,
): boolean {
  if (role.kind === "surface") {
    return (
      role.target.source.kind === "browser" &&
      role.target.source.tabId === tabId &&
      scopedThreadKey(role.target.threadRef) === scopedThreadKey(threadRef)
    );
  }
  return !(browserTabKey(threadRef, tabId) in claims);
}

export function surfaceWindowTargetAt(location: {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}): SurfaceWindowTarget | null {
  const hashPath = location.hash.startsWith("#/") ? location.hash.slice(1) : null;
  const [path, search] =
    hashPath !== null
      ? [
          hashPath.split("?")[0],
          hashPath.includes("?") ? hashPath.slice(hashPath.indexOf("?")) : "",
        ]
      : [location.pathname, location.search];
  if (path !== SURFACE_WINDOW_PATH) return null;
  return parseSurfaceWindowSearch(Reflect.get(defaultParseSearch(search), "surface"));
}

const listeners = new Set<() => void>();
let snapshot: Claims | null = null;

const readClaims = (): Claims => {
  try {
    return parseClaims(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
};

const writeClaims = (claims: Claims) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(claims));
  } catch {}
  snapshot = claims;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    snapshot = parseClaims(event.newValue);
    listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

const getSnapshot = (): Claims => (snapshot ??= readClaims());

export const useSurfaceWindowClaims = (): Claims => useSyncExternalStore(subscribe, getSnapshot);

let role: SurfaceWindowRole | null = null;

export function surfaceWindowRole(): SurfaceWindowRole {
  if (role) return role;
  const target = typeof window === "undefined" ? null : surfaceWindowTargetAt(window.location);
  role = target ? { kind: "surface", target } : { kind: "main" };
  return role;
}

export function startSurfaceWindowRegistry(): () => void {
  const current = surfaceWindowRole();
  if (current.kind === "main") {
    try {
      if (window.sessionStorage.getItem(SESSION_KEY) === null) {
        window.sessionStorage.setItem(SESSION_KEY, "1");
        if (window.opener === null) writeClaims({});
      }
    } catch {}
    return () => {};
  }
  writeClaims(withClaim(readClaims(), current.target));
  const release = () => writeClaims(withoutClaim(readClaims(), current.target));
  window.addEventListener("pagehide", release);
  return () => {
    window.removeEventListener("pagehide", release);
    release();
  };
}
