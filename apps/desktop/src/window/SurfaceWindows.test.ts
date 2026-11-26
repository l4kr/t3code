import { assert, describe, it } from "@effect/vitest";

import { surfaceWindowRequest } from "./SurfaceWindows.ts";

describe("surfaceWindowRequest", () => {
  const app = "t3code://app/";

  it("accepts the app's own surface route, focused or not", () => {
    assert.deepStrictEqual(surfaceWindowRequest(`${app}#/surface?surface=%7B%7D`, app), {
      unfocused: false,
    });
    assert.deepStrictEqual(
      surfaceWindowRequest(`${app}#/surface?surface=%7B%22unfocused%22%3A%221%22%7D`, app),
      { unfocused: true },
    );
    assert.deepStrictEqual(
      surfaceWindowRequest(
        "http://localhost:5733/#/surface?surface=%7B%7D",
        "http://localhost:5733/",
      ),
      { unfocused: false },
    );
  });

  it.each([
    "https://example.com/#/surface",
    "t3code://app/#/env/thread",
    "t3code://app/#/surfaces",
    "t3code://evil/#/surface",
    "about:blank",
    "not a url",
  ])("refuses %s", (url) => {
    assert.isNull(surfaceWindowRequest(url, app));
  });
});
