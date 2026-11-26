import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";

import { previewMiniPlayerSourceKey, usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import { useRightPanelStore } from "~/rightPanelStore";
import type { AppRouter } from "~/router";

import {
  SURFACE_WINDOW_PATH,
  redirectWindowedSurface,
  surfaceWindowName,
  surfaceWindowSearch,
  type SurfaceWindowTarget,
} from "./surfaceWindow";
import { startAnnotationRelay } from "./annotationRelay";
import { startSurfaceWindowRegistry, surfaceWindowRole } from "./surfaceWindowRegistry";

const openWindows = new Map<string, Window>();

function openSurfaceWindow(router: AppRouter, target: SurfaceWindowTarget): boolean {
  const name = surfaceWindowName(target);
  const existing = openWindows.get(name);
  if (existing && !existing.closed) {
    if (!target.background) existing.focus();
    return true;
  }
  const location = router.buildLocation({
    to: SURFACE_WINDOW_PATH,
    search: { surface: surfaceWindowSearch(target) },
  });
  const href = new URL(router.history.createHref(location.href), window.location.href).href;
  const size = target.source.kind === "browser" ? "width=1200,height=860" : "width=480,height=960";
  const opened = window.open(href, name, `popup,${size}`);
  if (!opened) return false;
  openWindows.set(name, opened);
  return true;
}

export function startSurfaceWindows(router: AppRouter): () => void {
  const stopRegistry = startSurfaceWindowRegistry();
  const stopRelay = startAnnotationRelay(surfaceWindowRole(), router);
  if (surfaceWindowRole().kind === "surface") {
    return () => {
      stopRelay();
      stopRegistry();
    };
  }

  const panels = useRightPanelStore;
  const normalized = Object.fromEntries(
    Object.entries(panels.getState().byThreadKey).map(([threadKey, state]) => [
      threadKey,
      redirectWindowedSurface(undefined, state)?.state ?? state,
    ]),
  );
  panels.setState({ byThreadKey: normalized });

  let previousPanels = panels.getState().byThreadKey;
  const stopPanels = panels.subscribe((state) => {
    const previous = previousPanels;
    previousPanels = state.byThreadKey;
    for (const [threadKey, next] of Object.entries(state.byThreadKey)) {
      if (next === previous[threadKey]) continue;
      const redirect = redirectWindowedSurface(previous[threadKey], next);
      const threadRef = redirect ? parseScopedThreadKey(threadKey) : null;
      if (!redirect || !threadRef) continue;
      if (!openSurfaceWindow(router, { threadRef, source: redirect.source })) continue;
      panels.setState((current) => ({
        byThreadKey: { ...current.byThreadKey, [threadKey]: redirect.state },
      }));
    }
  });

  const miniPlayers = usePreviewMiniPlayerStore;
  let previousMiniPlayers = miniPlayers.getState().byThreadKey;
  const stopMiniPlayers = miniPlayers.subscribe((state) => {
    const previous = previousMiniPlayers;
    previousMiniPlayers = state.byThreadKey;
    for (const [threadKey, next] of Object.entries(state.byThreadKey)) {
      const before = previous[threadKey];
      if (
        before &&
        previewMiniPlayerSourceKey(before.source) === previewMiniPlayerSourceKey(next.source)
      )
        continue;
      const threadRef = parseScopedThreadKey(threadKey);
      if (!threadRef) continue;
      if (openSurfaceWindow(router, { threadRef, source: next.source, background: true })) {
        miniPlayers.getState().close(threadRef);
      }
    }
  });

  return () => {
    stopPanels();
    stopMiniPlayers();
    stopRelay();
    stopRegistry();
  };
}
