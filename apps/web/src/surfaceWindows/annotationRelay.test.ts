import type {
  EnvironmentId,
  PreviewAnnotationPayload,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ComposerImageAttachment } from "~/composerDraftStore";

import { newAnnotations, type RelayedAnnotation } from "./annotationRelay";

const threadRef: ScopedThreadRef = {
  environmentId: "env-1" as EnvironmentId,
  threadId: "thread-1" as ThreadId,
};
const annotation = (id: string) => ({ id }) as unknown as PreviewAnnotationPayload;
const image = (id: string) => ({ id, type: "image" }) as unknown as ComposerImageAttachment;

describe("newAnnotations", () => {
  it("relays each annotation the window adds once, with its screenshot", () => {
    const relayed: RelayedAnnotation[] = newAnnotations(
      threadRef,
      { previewAnnotations: [annotation("a")], images: [] },
      { previewAnnotations: [annotation("a"), annotation("b")], images: [image("b"), image("x")] },
    );
    expect(relayed).toEqual([{ threadRef, annotation: annotation("b"), image: image("b") }]);
  });

  it("relays nothing when annotations are removed or unchanged", () => {
    const draft = { previewAnnotations: [annotation("a")], images: [] };
    expect(newAnnotations(threadRef, draft, draft)).toEqual([]);
    expect(newAnnotations(threadRef, draft, { previewAnnotations: [], images: [] })).toEqual([]);
  });

  it("relays an annotation without a screenshot", () => {
    expect(
      newAnnotations(threadRef, null, { previewAnnotations: [annotation("a")], images: [] }),
    ).toEqual([{ threadRef, annotation: annotation("a"), image: null }]);
  });
});
