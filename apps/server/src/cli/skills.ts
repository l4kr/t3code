import { AuthStandardClientScopes, EnvironmentHttpApi } from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import { Command, GlobalFlag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import * as HttpApiClient from "effect/http-api/HttpApiClient";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import { readLiveServerRuntimeState } from "../serverRuntimeState.ts";
import { type CliAuthLocationFlags, projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

const SKILLS_RESCAN_TIMEOUT = Duration.minutes(2);

export class SkillsRescanNoServerError extends Schema.TaggedError<SkillsRescanNoServerError>()(
  "SkillsRescanNoServerError",
  {},
) {
  override get message(): string {
    return "T3 Code is not running on this machine.";
  }
}

export class SkillsRescanRequestError extends Schema.TaggedError<SkillsRescanRequestError>()(
  "SkillsRescanRequestError",
  { origin: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `T3 Code at ${this.origin} did not rescan skills.`;
  }
}

const rescanSkillsOnLiveServer = Effect.fn("skills.rescanOnLiveServer")(function* (
  flags: CliAuthLocationFlags,
) {
  const logLevel = yield* GlobalFlag.LogLevel;
  const config = yield* resolveCliAuthConfig(flags, logLevel);
  return yield* Effect.gen(function* () {
    const runtimeState = yield* readLiveServerRuntimeState(config.serverRuntimeStatePath);
    if (Option.isNone(runtimeState)) return yield* new SkillsRescanNoServerError();
    const origin = runtimeState.value.origin;
    const environmentAuth = yield* EnvironmentAuth.EnvironmentAuth;
    return yield* Effect.acquireUseRelease(
      environmentAuth.issueSession({ scopes: AuthStandardClientScopes, label: "t3 skills cli" }),
      (issued) =>
        HttpApiClient.make(EnvironmentHttpApi, { baseUrl: origin }).pipe(
          Effect.flatMap((client) =>
            client.projects.rescanSkills({
              headers: { authorization: `Bearer ${issued.token}` },
            }),
          ),
          Effect.timeout(SKILLS_RESCAN_TIMEOUT),
          Effect.mapError((cause) => new SkillsRescanRequestError({ origin, cause })),
        ),
      (issued) =>
        environmentAuth.revokeSession(issued.sessionId).pipe(Effect.ignore({ log: true })),
    );
  }).pipe(
    Effect.scoped,
    Effect.provide(
      EnvironmentAuth.layerRuntime.pipe(
        Layer.provideMerge(FetchHttpClient.layer),
        Layer.provide(ServerConfig.layer(config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, config.logLevel)),
      ),
    ),
  );
});

const skillsRescanCommand = Command.make("rescan", { ...projectLocationFlags }).pipe(
  Command.withDescription(
    "Rescan skills in the running T3 Code, so added or changed skills show up now.",
  ),
  Command.withHandler((flags) =>
    rescanSkillsOnLiveServer(flags).pipe(
      Effect.flatMap(({ rescanned }) =>
        Console.log(`Rescanned skills in ${rescanned} workspace${rescanned === 1 ? "" : "s"}.`),
      ),
    ),
  ),
);

export const skillsCommand = Command.make("skills").pipe(
  Command.withDescription("Manage the skills the running T3 Code offers."),
  Command.withSubcommands([skillsRescanCommand]),
);
