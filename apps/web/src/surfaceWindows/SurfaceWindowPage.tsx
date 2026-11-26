import { Suspense } from "react";

import { DevicePanel } from "~/components/device/DevicePanel";
import { PreviewPanel } from "~/components/preview/PreviewPanel";
import { previewMiniPlayerSourceKey } from "~/previewMiniPlayerStore";

import { relayAnnotationSend } from "./annotationRelay";
import { parseSurfaceWindowSearch, type SurfaceWindowSearch } from "./surfaceWindow";

export function SurfaceWindowPage({
  search,
}: {
  readonly search: SurfaceWindowSearch | undefined;
}) {
  const target = parseSurfaceWindowSearch(search);
  if (!target) return null;
  const { threadRef, source } = target;
  return (
    <div className="flex h-dvh w-full min-w-0 flex-col bg-background">
      <Suspense fallback={null}>
        {source.kind === "browser" ? (
          <PreviewPanel
            mode="embedded"
            threadRef={threadRef}
            tabId={source.tabId}
            visible
            onSendAnnotation={() => relayAnnotationSend(threadRef)}
          />
        ) : (
          <DevicePanel
            mode="embedded"
            threadRef={threadRef}
            surface={{
              id: previewMiniPlayerSourceKey(source) as `device:${string}`,
              kind: "device",
              target: {
                hostId: source.hostId,
                deviceId: source.deviceId,
                platform: source.platform,
                name: source.name,
              },
            }}
            visible
            onDismissSetup={() => window.close()}
          />
        )}
      </Suspense>
    </div>
  );
}
