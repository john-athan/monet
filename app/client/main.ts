import { mount } from "svelte";
import type { AccountState } from "../shared/accounts";
import App from "./App.svelte";
import { app, go, installLight, theme } from "./lib/state.svelte";
import { installKeys } from "./lib/keys";
import { api } from "./lib/api";

installLight();
document.documentElement.dataset.theme = theme();
installKeys();
mount(App, { target: document.getElementById("app")! });

(async () => {
  try {
    const s = await api<AccountState>("/api/auth/state", { quiet401: true });
    app.loggedIn = s.loggedIn; app.setupOpen = s.setupOpen;
    app.indexer = !!s.device && new URLSearchParams(location.search).get("darkroom") === "always";
  } catch { app.loggedIn = false; }
  app.ready = true;
})();

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("/sw.js").catch(() => {});
// a notification or the shell can ask the open page to go somewhere
navigator.serviceWorker?.addEventListener("message", e => { if (e.data?.type === "go" && typeof e.data.url === "string" && e.data.url.startsWith("/")) go(e.data.url); });
if (location.hostname === "localhost") Object.assign(window, { __monet: { app, go, api } });
