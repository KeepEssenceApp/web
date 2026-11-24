// Saving from the web inbox and the share target. The sentence shown is the core's.
import { api, ApiError } from "./api";
import { meta, refresh } from "./session";
import { shared, t } from "./i18n";
import { sha256Hex, toWebp } from "./lib";

const ASSET_TYPES = ["image/webp", "image/png", "image/jpeg", "image/gif", "application/pdf", "text/plain", "text/markdown"];
const limit = (name: string, fallback: number) => {
  const v = meta.get()?.limits?.[name];
  return typeof v === "number" ? v : fallback;
};

export interface Outcome {
  ok: boolean;
  sentence: string;
}

function failed(reason: string): Outcome {
  const template = meta.get()?.shared_rules.save_messages.failed;
  return { ok: false, sentence: template ? shared(template, { reason }) : reason };
}
function reasonOf(err: unknown): string {
  if (err instanceof ApiError) return err.status === 0 ? t("common.offline") : err.message || err.code;
  return String((err as Error)?.message ?? err);
}

const URL_ONLY = /^https?:\/\/\S+$/i;

export async function saveText(raw: string, entry: string, title?: string): Promise<Outcome> {
  const text = raw.trim();
  try {
    const body = URL_ONLY.test(text)
      ? { kind: "link" as const, url: text, title: title || undefined, entry }
      : { kind: "text" as const, text, title: title || undefined, entry };
    const res = await api.save(body);
    refresh.set((n) => n + 1);
    return { ok: true, sentence: res.message };
  } catch (err) {
    return failed(reasonOf(err));
  }
}

export async function saveFile(file: File, entry: string): Promise<Outcome> {
  const max = limit("asset_max_bytes", 3145728);
  try {
    let blob: Blob = file;
    let type = file.type || (file.name.endsWith(".md") ? "text/markdown" : "");
    const isImage = type.startsWith("image/");
    if (isImage) {
      // Every image goes up as WebP with the long edge at the contract's limit.
      blob = await toWebp(file, limit("image_long_edge_px", 1600), max);
      type = "image/webp";
    }
    if (!ASSET_TYPES.includes(type)) return failed(t("inbox.bad_type"));
    if (blob.size > max) return failed(t("inbox.too_large", { mb: Math.round(max / 1048576) }));
    const bytes = await blob.arrayBuffer();
    const asset = await api.requestUpload({ sha256: await sha256Hex(bytes), bytes: blob.size, content_type: type });
    if (asset.status === "upload" && asset.upload_url) {
      const put = await fetch(asset.upload_url, { method: "PUT", headers: { "Content-Type": type }, body: bytes });
      if (!put.ok) throw new ApiError(put.status, "server_error", "");
      await api.completeUpload(asset.asset_id);
    }
    // `over_quota`: nothing is uploaded; the core still records the item and says so.
    const res = await api.save({
      kind: isImage ? "image" : "file",
      asset_id: asset.asset_id,
      title: file.name && !/^image\.\w+$/.test(file.name) ? file.name.slice(0, 300) : undefined,
      entry,
    });
    refresh.set((n) => n + 1);
    return { ok: true, sentence: res.message };
  } catch (err) {
    return failed(err instanceof Error && err.message === "webp" ? t("inbox.bad_type") : reasonOf(err));
  }
}

/** Several things saved together still end in the fewest sentences that are true. */
export function combine(outcomes: Outcome[]): Outcome {
  const sentences = [...new Set(outcomes.map((o) => o.sentence))];
  return { ok: outcomes.every((o) => o.ok), sentence: sentences.join(" ") };
}
