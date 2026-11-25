import { api } from "../api";
import { t } from "../i18n";
import { downloadBlob, say, useBusy } from "../lib";

const EXTENSION: Record<string, string> = {
  "text/plain": "txt",
  "text/markdown": "md",
  "application/pdf": "pdf",
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
};

/** What a browser shows in a tab of its own. Everything else is downloaded. */
const opensInTab = (type: string) => type.startsWith("image/") || type === "application/pdf";

/** A name to download under: the given one, with the type's ending when it has none. */
export function fileName(name: string, type: string): string {
  const base = name.trim().replace(/[\\/:*?"<>|\n\r]+/g, " ") || "file";
  const ext = EXTENSION[type];
  return !ext || /\.[A-Za-z0-9]{1,5}$/.test(base) ? base : `${base}.${ext}`;
}

/**
 * What the control of a stored file says: it names what pressing it does. A text file's text is
 * already on the item page under "Original", so the file itself is offered as a download.
 */
export const fileLabel = (type: string) =>
  type.startsWith("image/") ? t("item.open_image") : opensInTab(type) ? t("item.attachment") : t("item.download_file");

/**
 * The control of one stored file (QA #31). An image or a PDF opens in a new tab; any other file
 * is downloaded under its name. Pressing it shows something at once: the tab is opened in the
 * press itself (a browser refuses one opened after waiting for the core) and the control is busy
 * until the bytes are there. A refusal is said in one sentence.
 */
export function SavedFile({ assetId, type, name, label }: { assetId: string; type: string; name: string; label?: string }) {
  const [busy, run] = useBusy();
  const press = () => {
    let tab: Window | null = null;
    if (opensInTab(type)) {
      tab = window.open("", "_blank");
      if (tab) {
        tab.opener = null;
        tab.document.title = name;
        tab.document.body.textContent = t("common.loading");
      }
    }
    void run("file", async () => {
      try {
        const blob = await api.file(assetId);
        if (tab && !tab.closed) return tab.location.replace(URL.createObjectURL(blob));
        // No tab (this kind of file has none, or the browser refused it): the file is downloaded.
        const as = fileName(name, type);
        downloadBlob(as, blob);
        say(t("item.file_downloaded", { name: as }));
      } catch (err) {
        tab?.close();
        throw err;
      }
    });
  };
  return (
    <button class="link" type="button" data-testid="saved-file" disabled={busy !== null} aria-busy={busy === "file"} onClick={press}>
      {label ?? fileLabel(type)}
    </button>
  );
}
