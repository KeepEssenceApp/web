// A small, safe Markdown renderer for notes: headings, lists, quotes, code, emphasis, links.
// It builds elements, never HTML strings, so note text cannot inject markup.
import type { ComponentChildren, VNode } from "preact";

const safeUrl = (u: string) => (/^(https?:|mailto:)/i.test(u.trim()) ? u.trim() : null);

function inline(text: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>)\]]+))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2]) out.push(<strong>{m[2]}</strong>);
    else if (m[3]) out.push(<em>{m[3]}</em>);
    else if (m[4]) out.push(<code>{m[4]}</code>);
    else {
      const href = safeUrl(m[6] ?? m[7]);
      const label = m[5] ?? m[7];
      out.push(href ? <a class="link" href={href} target="_blank" rel="noopener noreferrer">{label}</a> : label);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: VNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
    } else if (line.startsWith("```")) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++) code.push(lines[i]);
      i++;
      blocks.push(<pre><code>{code.join("\n")}</code></pre>);
    } else if (/^#{1,6}\s/.test(line)) {
      const level = Math.min(line.match(/^#+/)![0].length + 1, 4);
      const body = inline(line.replace(/^#+\s+/, ""));
      blocks.push(level === 2 ? <h2>{body}</h2> : level === 3 ? <h3>{body}</h3> : <h4>{body}</h4>);
      i++;
    } else if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) quote.push(lines[i].replace(/^>\s?/, ""));
      blocks.push(<blockquote>{inline(quote.join(" "))}</blockquote>);
    } else if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: ComponentChildren[][] = [];
      for (; i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]); i++) items.push(inline(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, "")));
      const lis = items.map((it, k) => <li key={k}>{it}</li>);
      blocks.push(ordered ? <ol>{lis}</ol> : <ul>{lis}</ul>);
    } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push(<hr />);
      i++;
    } else {
      const para: ComponentChildren[] = [];
      for (; i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>|```|\s*([-*+]|\d+[.)])\s+)/.test(lines[i]); i++) {
        if (para.length) para.push(<br />);
        para.push(...inline(lines[i]));
      }
      blocks.push(<p>{para}</p>);
    }
  }
  return <div class="prose">{blocks}</div>;
}
