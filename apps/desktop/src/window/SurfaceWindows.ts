import * as Electron from "electron";

const SURFACE_PATH = "/surface";
const surfaceContentsIds = new Set<number>();

export const isSurfaceWindowContents = (webContentsId: number): boolean =>
  surfaceContentsIds.has(webContentsId);

export const isSurfaceWindowSender = (event: {
  readonly sender: { readonly id: number };
  readonly senderFrame?: unknown;
}): boolean =>
  surfaceContentsIds.has(event.sender.id) &&
  Electron.webContents.fromId(event.sender.id)?.mainFrame === event.senderFrame;

export function surfaceWindowRequest(
  url: string,
  applicationUrl: string,
): { readonly unfocused: boolean } | null {
  const target = URL.parse(url);
  const app = URL.parse(applicationUrl);
  if (!target || !app || target.protocol !== app.protocol || target.host !== app.host) return null;
  const route = target.hash.startsWith("#/")
    ? target.hash.slice(1)
    : target.pathname + target.search;
  const queryStart = route.indexOf("?");
  const path = queryStart < 0 ? route : route.slice(0, queryStart);
  if (path !== SURFACE_PATH) return null;
  const surface = new URLSearchParams(queryStart < 0 ? "" : route.slice(queryStart)).get("surface");
  let unfocused = false;
  try {
    unfocused = surface !== null && JSON.parse(surface)?.unfocused === "1";
  } catch {}
  return { unfocused };
}

export function surfaceWindowOpenResponse(
  details: Electron.HandlerDetails,
  options: {
    readonly applicationUrl: string;
    readonly webPreferences: Electron.WebPreferences;
    readonly backgroundColor: string;
  },
): Electron.WindowOpenHandlerResponse | null {
  if (!surfaceWindowRequest(details.url, options.applicationUrl)) return null;
  return {
    action: "allow",
    outlivesOpener: false,
    overrideBrowserWindowOptions: {
      show: false,
      autoHideMenuBar: true,
      backgroundColor: options.backgroundColor,
      webPreferences: options.webPreferences,
    },
  };
}

export function adoptSurfaceWindow(
  main: Electron.BrowserWindow,
  child: Electron.BrowserWindow,
  options: {
    readonly url: string;
    readonly applicationUrl: string;
    readonly onClosed: (webContentsId: number) => void;
  },
): void {
  const request = surfaceWindowRequest(options.url, options.applicationUrl);
  if (!request) return;
  const contents = child.webContents;
  const contentsId = contents.id;
  surfaceContentsIds.add(contentsId);
  contents.once("destroyed", () => {
    surfaceContentsIds.delete(contentsId);
    options.onClosed(contentsId);
  });

  contents.on("will-attach-webview", (event, webPreferences, params) => {
    main.webContents.emit("will-attach-webview", event, webPreferences, params);
  });
  contents.on("did-attach-webview", (event, guest) => {
    main.webContents.emit("did-attach-webview", event, guest);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void Electron.shell.openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (surfaceWindowRequest(url, options.applicationUrl)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void Electron.shell.openExternal(url);
  });

  const closeWithMain = () => {
    if (!child.isDestroyed()) child.close();
  };
  main.once("closed", closeWithMain);
  child.once("closed", () => main.removeListener("closed", closeWithMain));
  child.once("ready-to-show", () => {
    if (request.unfocused) child.showInactive();
    else child.show();
  });
}
