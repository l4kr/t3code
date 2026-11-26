import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";

import * as AnalyticsService from "./AnalyticsService.ts";

const layer: Layer.Layer<AnalyticsService.AnalyticsService> = AnalyticsService.layer;

it.effect("records nothing, even when the environment turns telemetry on", () =>
  Effect.gen(function* () {
    const analytics = yield* AnalyticsService.AnalyticsService;
    assert.isFalse(yield* analytics.record("client.turn.requested", { provider: "codex" }));
    assert.isFalse(yield* analytics.record("agent.feedback", { kind: "bug" }, { anonymous: true }));
    yield* analytics.recordOwners([{ source: "connect", ownerId: "owner" }], "server");
    yield* analytics.flush;
  }).pipe(Effect.provide(layer)),
);
