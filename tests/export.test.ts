// QA #25: the notes file is made in the browser from the core's export.
import { describe, expect, it } from "vitest";
import { exportFileName, localDate, notesFileName, notesMarkdown, type NoteLabels } from "../src/export";
import type { Note } from "../src/types";

const labels: NoteLabels = { heading: "Notes", date: "Date", assistant: "Assistant", byUser: "pasted back by the user", from: "From", sources: "Sources", digestOf: (day) => `From the daily digest of ${day}` };
const note = (over: Partial<Note>): Note => ({ id: "n", title: "Title", body: "Body.", created_at: "2026-11-24T04:00:00.000Z", assistant: { id: "a", name: "Helper" }, origin: null, sources: [], ...over });

describe("QA #25: export", () => {
  it("QA #25: the two files are named after the product and the day", () => {
    expect(exportFileName("2026-11-25")).toBe("keepessence-export-2026-11-25.json");
    expect(notesFileName("2026-11-25")).toBe("keepessence-notes-2026-11-25.md");
  });

  it("QA #25: the day is the day in the account's time zone, and an unknown zone falls back to the browser's", () => {
    const at = new Date("2026-11-24T20:30:00.000Z");
    expect(localDate("Asia/Shanghai", at)).toBe("2026-11-25");
    expect(localDate("America/Los_Angeles", at)).toBe("2026-11-24");
    expect(localDate("Nowhere/At_All", at)).toMatch(/^2026-11-2[45]$/);
  });

  it("QA #25: every note has its title, date, assistant, origin, sources and text; notes are newest first and clearly separated", () => {
    const md = notesMarkdown(
      {
        exported_at: "2026-11-25T01:00:00.000Z",
        notes: [
          note({ id: "old", title: "Older  note\nwith a break", body: "\nFirst.\n\n---\n\n# A heading inside\n", created_at: "2026-11-20T10:00:00.000Z" }),
          note({
            id: "new",
            title: "Newer note",
            body: "Second.",
            created_at: "2026-11-24T18:00:00.000Z",
            assistant: { id: "a", name: "Helper", submitted_by_user: true },
            origin: { item_id: "i1", item_title: "A [bracketed] page", item_url: "https://example.com/a", digest_day: "2026-11-23" },
            sources: [{ title: "With an address", url: "https://example.com/s" }, { title: "Without one", url: null }, { url: "https://example.com/only" }],
          }),
        ],
      },
      labels,
      "Asia/Shanghai",
    );
    expect(md).toBe(
      [
        "<!-- Notes: 2 · 2026-11-25 -->",
        "",
        "# Newer note",
        "",
        "- Date: 2026-11-25",
        "- Assistant: Helper (pasted back by the user)",
        "- From: [A \\[bracketed\\] page](https://example.com/a) · From the daily digest of 2026-11-23",
        "- Sources:",
        "  - [With an address](https://example.com/s)",
        "  - Without one",
        "  - [https://example.com/only](https://example.com/only)",
        "",
        "Second.",
        "",
        "---",
        "",
        "<!-- next note -->",
        "",
        "# Older note with a break",
        "",
        "- Date: 2026-11-20",
        "- Assistant: Helper",
        "",
        "First.",
        "",
        "---",
        "",
        "# A heading inside",
        "",
      ].join("\n"),
    );
    // The border between two notes is the rule that is followed by the marker, never a rule inside a note.
    expect(md.split("\n---\n\n<!-- next note -->\n\n")).toHaveLength(2);
  });

  it("QA #25: no notes give a file with only its first line", () => {
    expect(notesMarkdown({ exported_at: "2026-11-25T01:00:00.000Z", notes: [] }, labels, "UTC")).toBe("<!-- Notes: 0 · 2026-11-25 -->\n\n");
  });
});
