import type { PreviewAnnotationPayload, ScopedThreadRef } from "@t3tools/contracts";

import {
  type ComposerImageAttachment,
  type ComposerThreadDraftState,
  useComposerDraftStore,
} from "~/composerDraftStore";
import type { AppRouter } from "~/router";

import type { SurfaceWindowRole } from "./surfaceWindowRegistry";

const CHANNEL = "t3code:surface-annotations";

export interface RelayedAnnotation {
  readonly threadRef: ScopedThreadRef;
  readonly annotation: PreviewAnnotationPayload;
  readonly image: ComposerImageAttachment | null;
}

type RelayMessage =
  | ({ readonly kind: "add" } & RelayedAnnotation)
  | { readonly kind: "send"; readonly threadRef: ScopedThreadRef };

type DraftAnnotations = Pick<ComposerThreadDraftState, "previewAnnotations" | "images">;

export function newAnnotations(
  threadRef: ScopedThreadRef,
  before: DraftAnnotations | null,
  after: DraftAnnotations | null,
): RelayedAnnotation[] {
  const known = new Set(before?.previewAnnotations.map((annotation) => annotation.id));
  return (after?.previewAnnotations ?? [])
    .filter((annotation) => !known.has(annotation.id))
    .map((annotation) => ({
      threadRef,
      annotation,
      image: after?.images.find((image) => image.id === annotation.id) ?? null,
    }));
}

let channel: BroadcastChannel | null = null;
const openChannel = () => (channel ??= new BroadcastChannel(CHANNEL));

export function relayAnnotationSend(threadRef: ScopedThreadRef): void {
  openChannel().postMessage({ kind: "send", threadRef } satisfies RelayMessage);
  window.opener?.focus();
}

export function startAnnotationRelay(role: SurfaceWindowRole, router: AppRouter): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const relay = openChannel();
  const drafts = useComposerDraftStore;

  if (role.kind === "surface") {
    const { threadRef } = role.target;
    let before = drafts.getState().getComposerDraft(threadRef);
    return drafts.subscribe((state) => {
      const after = state.getComposerDraft(threadRef);
      const added = newAnnotations(threadRef, before, after);
      before = after;
      for (const annotation of added) {
        relay.postMessage({ kind: "add", ...annotation } satisfies RelayMessage);
      }
    });
  }

  const onMessage = (event: MessageEvent<RelayMessage>) => {
    const message = event.data;
    if (message.kind === "add") {
      drafts.getState().addPreviewAnnotation(message.threadRef, message.annotation);
      if (message.image) drafts.getState().addImage(message.threadRef, message.image);
      return;
    }
    window.focus();
    void router.navigate({
      to: "/$environmentId/$threadId",
      params: {
        environmentId: message.threadRef.environmentId,
        threadId: message.threadRef.threadId,
      },
    });
  };
  relay.addEventListener("message", onMessage);
  return () => relay.removeEventListener("message", onMessage);
}
