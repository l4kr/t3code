import { expect, it, vi } from "vite-plus/test";

const observe = vi.hoisted(() => {
  Reflect.set(globalThis, "__DEV__", false);
  return { configure: vi.fn(), dispatchEvents: vi.fn(async () => {}), reportError: vi.fn() };
});

vi.mock("expo-observe", () => ({ Observe: observe }));
vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      extra: { relay: { url: "https://relay.example.com" }, appVariant: "production" },
    },
  },
}));

it("keeps the setting but never dispatches crash reports, even with it on", async () => {
  const { crashReportingAvailable, setCrashReportsEnabled } = await import("./observe");
  await setCrashReportsEnabled(true);

  expect(crashReportingAvailable).toBe(true);
  expect(observe.dispatchEvents).not.toHaveBeenCalled();
  expect(observe.configure).toHaveBeenCalled();
  for (const [options] of observe.configure.mock.calls) {
    expect(options).toMatchObject({ dispatchingEnabled: false });
  }
});
