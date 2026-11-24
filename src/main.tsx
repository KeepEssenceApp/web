import { render } from "preact";
import "../design/tokens.css";
import "./styles/app.css";
import { App } from "./App";
import { go } from "./router";
import { refresh } from "./session";

render(<App />, document.getElementById("app")!);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  // A notification arrived while the page is open, or one was pressed.
  navigator.serviceWorker.addEventListener("message", (ev) => {
    if (ev.data?.type === "refresh") refresh.set((n) => n + 1);
    if (ev.data?.type === "open" && typeof ev.data.url === "string" && ev.data.url.startsWith("/")) go(ev.data.url);
  });
}
