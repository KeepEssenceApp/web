// Shapes from contract/openapi.yaml. Only what the screens use.
export type Lang = "zh" | "en";
export type Tier = "save" | "read" | "manage";
export type Step = "triage" | "analysis" | "digest" | "deep_read" | "deep_dive";
export type AssistantKind = "scheduled" | "chat";
export type ClientKind = "web" | "phone" | "extension" | "shortcut" | "share" | "menubar" | "eink";
export type ItemKind = "link" | "text" | "image" | "file";
export type Verdict = "worth_deep_dive" | "good_to_know" | "skippable";
export type Signal = "not_interested" | "seen";
export type LangText = Record<Lang, string>;

export interface SharedRules {
  secret_like: { max_length_checked: number; patterns: { name: string; regex: string; flags?: string }[] };
  save_messages: Record<string, LangText>;
  verdicts: Record<Verdict, LangText>;
  content_unavailable: LangText;
  notifications: Record<string, LangText>;
  opening_line: LangText;
}
export interface Meta {
  contract_version: string;
  limits: Record<string, number | number[]>;
  shared_rules: SharedRules;
}

export interface User { id: string; timezone: string; lang?: Lang }
export interface Device {
  id: string;
  name: string;
  category: "client" | "assistant";
  client?: ClientKind;
  tier?: Tier;
  steps?: Step[];
  created_at: string;
  last_used_at?: string | null;
  notifications?: boolean;
  this_device?: boolean;
}
export interface DeviceGrant { credential: string; device: Device; user: User }

export interface Signature { id: string; name: string; submitted_by_user?: boolean }
export interface Analysis {
  unavailable: boolean;
  summary?: string;
  key_fact?: string;
  points?: string[];
  verdict?: Verdict;
  related_hint?: string | null;
  assistant: Signature;
  created_at?: string;
}
export interface Item {
  id: string;
  kind: ItemKind;
  title: string;
  site?: string | null;
  url?: string | null;
  created_at: string;
  stage: "saved" | "triaged" | "analysed";
  content_unavailable?: boolean;
  dispatch_to?: { id: string; name: string } | null;
  days_left?: number | null;
  pinned?: boolean;
  signal?: Signal | null;
  in_queue?: boolean;
  analysis?: Analysis | null;
}
export interface ItemDetail extends Item {
  body?: string | null;
  asset_id?: string | null;
  tags?: string[];
  expiry_days?: number | null;
}
export interface SaveResult {
  status: "saved" | "duplicate";
  item_id?: string;
  message_key: string;
  message: string;
  image_stored?: boolean;
}

export interface DigestWorth {
  item_id: string;
  title?: string;
  line: string;
  verdict?: Verdict;
  available?: boolean;
  in_queue?: boolean;
}
export interface DigestRest {
  item_id: string;
  title: string;
  signal?: string | null;
  in_queue?: boolean;
  available?: boolean;
  can_restore?: boolean;
}
export interface Digest {
  day: string;
  read: boolean;
  counts?: { saved?: number; worth?: number };
  summary: string;
  worth: DigestWorth[];
  rest: DigestRest[];
  question: string;
  assistant: Signature;
  previous_day?: string | null;
  next_day?: string | null;
}

export interface DeepReadReport { read: string; found: string; questions: string[]; assistant?: Signature }
export interface QueueEntry {
  item_id: string;
  title: string;
  added_at: string;
  deep_read: "waiting" | "reading" | "ready" | "none";
  report?: DeepReadReport | null;
  went_at?: string | null;
  fetched_at?: string | null;
  entry?: string | null;
}
export interface DeepDiveEntry {
  assistant: Signature;
  opening_line: string;
  open_url?: string | null;
  entry?: string | null;
}

export interface NoteSummary { id: string; title: string; excerpt?: string; created_at: string }
export interface Note {
  id: string;
  title: string;
  body: string;
  created_at: string;
  assistant: Signature;
  origin?: { item_id?: string | null; item_title?: string; item_url?: string | null; digest_day?: string | null } | null;
  sources?: { title?: string; url?: string | null }[];
  asset_ids?: string[];
}

export type AssistantState = "working" | "recent" | "quiet" | "never";
export interface Status {
  assistants: { id: string; name: string; state: AssistantState; last_seen_at?: string | null }[];
  saved_today: number;
  waiting: number;
  oldest_waiting_deleted_on?: string | null;
  no_digest_reason?: "not_yet_time" | "nothing_analysed" | "no_assistant" | "waiting_for_assistant" | null;
}

export type DayMark = "empty" | "saved" | "digest_unread" | "digest_read" | "note" | "future";
export interface Calendar {
  month: string;
  today?: string;
  days: { day: string; mark: DayMark; has_digest?: boolean }[];
  counts: { saved: number; digests: number; read: number; notes: number };
  previous_month?: string | null;
  next_month?: string | null;
}

export interface Assistant {
  id: string;
  name: string;
  kind: AssistantKind;
  steps: Step[];
  built_in: boolean;
  connected_at?: string | null;
  last_seen_at?: string | null;
  runs_at?: string | null;
}
export type Role = "analysis" | "digest" | "deep_read" | "deep_dive";
export interface Settings {
  rules: string;
  expiry_options: number[];
  notify: boolean;
  timezone: string;
  lang: Lang;
  roles: Partial<Record<Role, string | null>>;
  calendar_image: { enabled: boolean; url?: string | null };
}
export interface SettingsChange {
  rules?: string;
  expiry_options?: number[];
  notify?: boolean;
  timezone?: string;
  lang?: Lang;
  roles?: Partial<Record<Role, string | null>>;
  calendar_image_enabled?: boolean;
}

export interface DeviceCodeRequest { device_name: string; client: ClientKind; requested_tier: Tier; expires_at: string }
export interface AuthorizationRequest {
  client_name: string;
  client_uri?: string | null;
  redirect_host: string;
  steps_requested: Step[];
}
