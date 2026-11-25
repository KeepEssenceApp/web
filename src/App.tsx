import { useEffect, useState } from "preact/hooks";
import { api } from "./api";
import { DeepReadPanel, DigestDates, NotesRest, TodayRest } from "./components/Panels";
import { Shell } from "./components/Shell";
import { Split } from "./components/Split";
import { Loading, Said } from "./components/ui";
import { lang as currentLang, langStore, setLang, t } from "./i18n";
import { WIDE, errText, useMedia } from "./lib";
import { AssistantsPage, type Section } from "./pages/AssistantsPage";
import { Approve } from "./pages/Approve";
import { Authorize } from "./pages/Authorize";
import { CalendarPage } from "./pages/CalendarPage";
import { DigestPage } from "./pages/DigestPage";
import { ItemPage } from "./pages/ItemPage";
import { NotePage } from "./pages/NotePage";
import { NotesPage } from "./pages/NotesPage";
import { SaveOnly, SharePage } from "./pages/SharePage";
import { SignIn } from "./pages/SignIn";
import { Today } from "./pages/Today";
import { go, onLinkClick, useRoute } from "./router";
import { digestUnread, dropSession, meta, refresh, session } from "./session";
import { useStore } from "./store";

const SECTIONS: Section[] = ["assistants", "connect", "rules", "devices", "calendar", "notify", "account"];

export function App() {
  const lang = useStore(langStore);
  const s = useStore(session);
  const m = useStore(meta);
  const tick = useStore(refresh);
  const route = useRoute();
  // Wide screens show a list and, beside it, what is open. Narrower ones show one thing at a time.
  const wide = useMedia(WIDE);
  const [bootError, setBootError] = useState<string | null>(null);

  // The shared rules come from the core, once.
  useEffect(() => {
    if (!m) api.meta().then(meta.set, (err) => setBootError(errText(err)));
  }, [m]);
  // Who this device is and which tier it has.
  useEffect(() => {
    if (s.signedIn && !s.device)
      api.me().then(
        (me) => session.set({ signedIn: true, device: me.device, user: me.user }),
        (err) => session.get().signedIn && setBootError(errText(err)),
      );
  }, [s.signedIn, s.device]);
  // The account has one language: analyses and daily digests are written in it, and the interface
  // of a signed-in device follows it (QA #18). Before sign-in the browser's language decides.
  const accountLang = s.user?.lang;
  useEffect(() => {
    if (accountLang && accountLang !== currentLang()) setLang(accountLang);
  }, [accountLang]);
  // One dot on the daily digest entry while the latest one is unread.
  const reads = s.device?.tier === "read" || s.device?.tier === "manage";
  useEffect(() => {
    if (reads) api.digests(1).then((d) => digestUnread.set(d.digests[0]?.read === false), () => undefined);
  }, [reads, tick, route.path]);

  const seg = route.path.split("/").filter(Boolean);
  const page = seg[0] ?? "";
  const query = new URLSearchParams(route.search);

  let body;
  if (!s.signedIn) body = <SignIn returning={page === "approve" || page === "authorize"} />;
  else if (!s.device || !m) body = <main class="standalone"><Loading error={bootError} /></main>;
  else if (page === "share") body = <SharePage search={route.search} />;
  else if (s.device.tier === "save") body = <SaveOnly onSignOut={() => api.signOut().then(dropSession, dropSession)} />;
  else if (page === "approve") body = <Approve code={(query.get("code") ?? "").trim().toUpperCase()} />;
  else if (page === "authorize") body = <Authorize request={query.get("request") ?? ""} />;
  else if (page === "calendar") body = <Shell current="notes"><CalendarPage month={seg[1]} wide={wide} day={query.get("day")} /></Shell>;
  else if (page === "assistants" && s.device.tier === "manage") {
    const section = (SECTIONS.includes(seg[1] as Section) ? seg[1] : "assistants") as Section;
    body = <Shell current="assistants"><AssistantsPage section={section} wide={wide} /></Shell>;
  } else if (wide) {
    // The same addresses as on a narrow screen; the opened thing sits beside its list.
    const at = route.path + route.search;
    if (page === "digest") {
      const day = seg[1] ?? "latest";
      const base = seg[1] ? `/digest/${seg[1]}` : "/digest";
      const item = query.get("item");
      body = (
        <Shell current="digest">
          <Split
            label={t("panel.digest")}
            at={at}
            close={base}
            list={<DigestPage day={day} beside selected={item} />}
            panel={item ? <ItemPage key={item} id={item} back={base} panel /> : <DigestDates day={day} />}
          />
        </Shell>
      );
    } else if (page === "notes") {
      const read = seg[1] ? null : query.get("read");
      body = (
        <Shell current="notes">
          <Split
            label={t("panel.note")}
            at={at}
            close="/notes"
            list={<NotesPage beside selected={seg[1]} reading={read} />}
            panel={seg[1] ? <NotePage key={seg[1]} id={seg[1]} panel /> : read ? <DeepReadPanel key={read} itemId={read} /> : <NotesRest />}
          />
        </Shell>
      );
    } else {
      const item = page === "item" ? seg[1] : undefined;
      if (page !== "" && !item) queueMicrotask(() => go("/", true));
      body = (
        <Shell current="today">
          <Split
            label={t("panel.item")}
            at={at}
            close="/"
            list={<Today selected={item} />}
            panel={item ? <ItemPage key={item} id={item} back="/" panel /> : <TodayRest />}
          />
        </Shell>
      );
    }
  } else if (page === "item" && seg[1]) body = <Shell current="today"><ItemPage key={seg[1]} id={seg[1]} /></Shell>;
  else if (page === "digest") body = <Shell current="digest"><DigestPage day={seg[1] ?? "latest"} /></Shell>;
  else if (page === "notes" && seg[1]) body = <Shell current="notes"><NotePage key={seg[1]} id={seg[1]} /></Shell>;
  else if (page === "notes") body = <Shell current="notes"><NotesPage /></Shell>;
  else {
    if (page !== "") queueMicrotask(() => go("/", true));
    body = <Shell current="today"><Today /></Shell>;
  }

  return (
    <div class="app" key={lang} onClick={onLinkClick}>
      {body}
      <Said />
    </div>
  );
}
