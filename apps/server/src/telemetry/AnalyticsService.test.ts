import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HostProcess from "@t3tools/shared/HostProcess";

import type { ManagedPolicyDocument } from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import { getTelemetryIdentity } from "./Identify.ts";
import * as AnalyticsService from "./AnalyticsService.ts";

const SentBatch = Schema.fromJsonString(
  Schema.Struct({
    batch: Schema.Array(
      Schema.Struct({
        uuid: Schema.String,
        event: Schema.String,
        distinct_id: Schema.String,
        properties: Schema.Struct({
          telemetryChannel: Schema.String,
          installId: Schema.optionalKey(Schema.String),
          serverOs: Schema.optionalKey(Schema.String),
          ownerSource: Schema.optionalKey(Schema.String),
          observedBy: Schema.optionalKey(Schema.String),
        }),
      }),
    ),
  }),
);
const decodeSentBatch = Schema.decodeEffect(SentBatch);
type SentEvent = (typeof SentBatch.Type)["batch"][number];
type Respond = (
  request: HttpClientRequest.HttpClientRequest,
) => Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>;

const respondWithStatus =
  (status: number): Respond =>
  (request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status })));

/**
 * Answers 503 for `minutes` after the first send, then 204. `answers` holds each
 * answer with its time in ms after the first send (the test clock runs on across tests).
 */
const failingFor = (minutes: number) => {
  const answers: Array<{ readonly at: number; readonly status: number }> = [];
  let firstSend: number | undefined;
  const respond: Respond = (request) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) => {
      firstSend ??= now;
      const at = now - firstSend;
      const status = at < minutes * 60_000 ? 503 : 204;
      answers.push({ at, status });
      return respondWithStatus(status)(request);
    });
  return { respond, answers };
};

const recordFeedback = Effect.gen(function* () {
  const analytics = yield* AnalyticsService.AnalyticsService;
  yield* analytics.record("test.retry", { index: 0 }, { anonymous: true });
});

const analyticsLayerWith = (
  client: HttpClient.HttpClient,
  policy?: ManagedPolicyDocument,
  telemetryEnv: { readonly T3CODE_TELEMETRY_ENABLED?: boolean } = {
    T3CODE_TELEMETRY_ENABLED: true,
  },
) =>
  AnalyticsService.layer.pipe(
    Layer.provideMerge(
      ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "t3-telemetry-retry-" }),
    ),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          ...telemetryEnv,
          T3CODE_TELEMETRY_KEY: "phc_test_key",
          T3CODE_TELEMETRY_HOST: "http://localhost",
        }),
      ),
    ),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(HostProcess.Platform, "win32"),
        Layer.succeed(HostProcess.Architecture, "x64"),
        Layer.succeed(HttpClient.HttpClient, client),
        ManagedPolicy.layerTest(policy),
      ),
    ),
  );

/**
 * Runs `record` (20 events by default), then lets `minutes` of background
 * flushes run against a client that answers every send with `respond`.
 * Returns the sent batches.
 */
const sendFor = (
  minutes: number,
  respond: Respond,
  record: Effect.Effect<
    void,
    never,
    AnalyticsService.AnalyticsService | Effect.Services<typeof getTelemetryIdentity>
  > = recordFeedback,
  policy?: ManagedPolicyDocument,
  telemetryEnv?: Parameters<typeof analyticsLayerWith>[2],
) =>
  Effect.gen(function* () {
    const batches: Array<ReadonlyArray<SentEvent>> = [];
    const client = HttpClient.make((request) =>
      Effect.gen(function* () {
        if (request.body._tag === "Uint8Array") {
          const body = yield* decodeSentBatch(new TextDecoder().decode(request.body.body)).pipe(
            Effect.orDie,
          );
          batches.push(body.batch);
        }
        return yield* respond(request);
      }),
    );
    const runtimeLayer = analyticsLayerWith(client, policy, telemetryEnv);

    yield* Effect.gen(function* () {
      yield* record;
      for (let second = 0; second < minutes * 60; second += 1) {
        yield* TestClock.adjust("1 second");
      }
    }).pipe(Effect.provide(runtimeLayer));
    return batches;
  });

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("AnalyticsService test", (it) => {
  it.effect("waits for desktop shell consent and honors a late telemetry opt-out", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { T3CODE_DESKTOP_SHELL_DISCOVERY_PENDING: "1" };
      const batches = yield* sendFor(
        0,
        respondWithStatus(204),
        Effect.gen(function* () {
          const analytics = yield* AnalyticsService.AnalyticsService;
          yield* analytics.record("test.before-discovery", {}, { anonymous: true });
          yield* analytics.flush;
          env.T3CODE_TELEMETRY_ENABLED = "false";
          delete env.T3CODE_DESKTOP_SHELL_DISCOVERY_PENDING;
          yield* analytics.record("test.opted-out", {}, { anonymous: true });
          yield* analytics.flush;
          env.T3CODE_TELEMETRY_ENABLED = "true";
          yield* analytics.record("test.allowed", {}, { anonymous: true });
          yield* analytics.flush;
        }),
      ).pipe(Effect.provideService(HostProcess.Environment, env));
      assert.deepEqual(
        batches.flat().map((event) => event.event),
        ["test.allowed"],
      );
    }),
  );

  it.effect("sends only feedback the user sends, even with telemetry turned on", () =>
    Effect.gen(function* () {
      const recorded: Array<boolean> = [];
      const batches = yield* sendFor(
        0,
        respondWithStatus(204),
        Effect.gen(function* () {
          const analytics = yield* AnalyticsService.AnalyticsService;
          recorded.push(yield* analytics.record("client.turn.requested"));
          yield* analytics.recordOwners([{ source: "connect", ownerId: "owner" }], "server");
          recorded.push(yield* analytics.record("agent.feedback", {}, { anonymous: true }));
          yield* analytics.flush;
        }),
      ).pipe(Effect.provideService(HostProcess.Environment, {}));
      assert.deepEqual(recorded, [false, true]);
      assert.deepEqual(
        batches.flat().map((event) => event.event),
        ["agent.feedback"],
      );
    }),
  );

  it.effect("sends nothing while DO_NOT_TRACK is set", () =>
    Effect.gen(function* () {
      const env: NodeJS.ProcessEnv = { DO_NOT_TRACK: "1" };
      const batches = yield* sendFor(
        0,
        respondWithStatus(204),
        Effect.gen(function* () {
          const analytics = yield* AnalyticsService.AnalyticsService;
          yield* analytics.record("test.do-not-track", {}, { anonymous: true });
          yield* analytics.flush;
          env.DO_NOT_TRACK = "0";
          yield* analytics.record("test.allowed", {}, { anonymous: true });
          yield* analytics.flush;
        }),
      ).pipe(Effect.provideService(HostProcess.Environment, env));
      assert.deepEqual(
        batches.flat().map((event) => event.event),
        ["test.allowed"],
      );
    }),
  );

  it.effect("sends feedback under its own id and without the install id", () =>
    Effect.gen(function* () {
      const batches = yield* sendFor(
        0,
        respondWithStatus(204),
        Effect.gen(function* () {
          const analytics = yield* AnalyticsService.AnalyticsService;
          yield* analytics.record("test.anonymous", {}, { anonymous: true });
          yield* analytics.flush;
        }),
      );
      const [anonymous] = batches.flat();
      assert.equal(anonymous?.distinct_id, anonymous?.uuid);
      assert.isUndefined(anonymous?.properties.installId);
      assert.isUndefined(anonymous?.properties.serverOs);
    }),
  );

  it.effect("keeps a failed batch through a 20-minute outage and sends it once after", () =>
    Effect.gen(function* () {
      const ingest = failingFor(20);
      const batches = yield* sendFor(40, ingest.respond);
      const statuses = ingest.answers.map(({ status }) => status);
      assert.equal(statuses.at(-1), 204);
      assert.equal(statuses.filter((status) => status === 204).length, 1);
      const sentUuids = new Set(batches.map((batch) => batch.map(({ uuid }) => uuid).join()));
      assert.equal(sentUuids.size, 1);
      assert.equal(batches[0]?.length, 1);
    }),
  );

  it.effect("drops a batch that keeps failing for 30 minutes", () =>
    Effect.gen(function* () {
      const ingest = failingFor(Infinity);
      yield* sendFor(60, ingest.respond);
      const lastSend = ingest.answers.at(-1)?.at ?? 0;
      assert.isAtLeast(lastSend, 30 * 60_000);
      assert.isBelow(lastSend, 36 * 60_000);
    }),
  );

  it.effect(
    "sends nothing when a managed policy turns telemetry off, despite the environment",
    () =>
      Effect.gen(function* () {
        const policy = { schemaVersion: 1, organization: "Example Corp" } as const;
        const allowed = yield* sendFor(1, respondWithStatus(204), recordFeedback, {
          ...policy,
          limits: { telemetry: true },
        });
        assert.equal(allowed.length, 1);
        const denied = yield* sendFor(1, respondWithStatus(204), recordFeedback, {
          ...policy,
          limits: { telemetry: false },
        });
        assert.deepEqual(denied, []);
      }),
  );

  it.effect("sends nothing on a CI runner unless the environment opts in", () =>
    Effect.gen(function* () {
      const onCi = (telemetryEnv: Parameters<typeof analyticsLayerWith>[2]) =>
        sendFor(1, respondWithStatus(204), recordFeedback, undefined, telemetryEnv).pipe(
          Effect.provideService(HostProcess.Environment, { GITHUB_ACTIONS: "true" }),
        );
      assert.deepEqual(yield* onCi({}), []);
      assert.equal((yield* onCi({ T3CODE_TELEMETRY_ENABLED: true })).length, 1);
    }),
  );

  it.effect("drops a batch the endpoint rejects without sending it again", () =>
    Effect.gen(function* () {
      const batches = yield* sendFor(10, respondWithStatus(400));
      assert.equal(batches.length, 1);
    }),
  );

  it.effect("shutdown stops waiting for a telemetry endpoint that never answers", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        analyticsLayerWith(HttpClient.make(() => Effect.never)),
        scope,
      );
      yield* recordFeedback.pipe(Effect.provide(context));

      const shutdown = yield* Scope.close(scope, Exit.void).pipe(Effect.forkChild);
      yield* TestClock.adjust("1 second");
      yield* Fiber.join(shutdown);
    }),
  );

  it.effect("does not send batch requests when telemetry is disabled", () =>
    Effect.gen(function* () {
      const capturedPaths: Array<string> = [];
      const layerServerConfig = ServerConfig.ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-telemetry-disabled-",
      });
      const layerTelemetry = AnalyticsService.layer.pipe(Layer.provideMerge(layerServerConfig));
      const layerConfig = ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          T3CODE_TELEMETRY_ENABLED: false,
          T3CODE_TELEMETRY_KEY: "phc_test_key",
          T3CODE_TELEMETRY_HOST: "http://localhost",
        }),
      );
      const layerBatchServer = HttpServer.serve(
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          capturedPaths.push(request.url);
          return HttpServerResponse.jsonUnsafe({});
        }),
      );
      const layerRuntime = layerTelemetry.pipe(
        Layer.provide(layerConfig),
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(HostProcess.Platform, "linux"),
            Layer.succeed(HostProcess.Architecture, "arm64"),
            ManagedPolicy.layerTest(),
          ),
        ),
        Layer.provideMerge(NodeHttpServer.layerTest),
      );

      yield* Effect.gen(function* () {
        yield* Layer.launch(layerBatchServer).pipe(Effect.forkScoped);
        const analytics = yield* AnalyticsService.AnalyticsService;
        yield* analytics.record("test.disabled", { index: 1 }, { anonymous: true });
        yield* analytics.flush;
      }).pipe(Effect.provide(layerRuntime));

      assert.deepEqual(capturedPaths, []);
    }),
  );
});
