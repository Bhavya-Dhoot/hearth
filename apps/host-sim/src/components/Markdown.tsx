import type { ReactNode } from "react";
import styles from "./Markdown.module.css";

/**
 * A deliberately small markdown renderer for the legal pages: headings, paragraphs,
 * (nested) lists, tables, blockquotes, fenced code, rules, and inline code / emphasis / links.
 * It builds React elements, never HTML strings, so document text cannot inject markup.
 */

const SAFE_HREF = /^(https?:\/\/|mailto:|\/|#)/i;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // order matters: code first so its contents are left alone
  const re =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\[[^\]]+\]\([^)\s]+\))|(<https?:\/\/[^>\s]+>)|(\*[^*\s][^*]*\*)|(\b_[^_\s][^_]*_\b)|(https?:\/\/[^\s<)]+)/g;
  let last = 0;
  let i = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (m[1]) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else if (m[2] || m[3]) out.push(<strong key={key}>{inline(tok.slice(2, -2), key)}</strong>);
    else if (m[4]) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      const href = mm[2]!;
      out.push(
        SAFE_HREF.test(href) ? (
          <a key={key} href={href} rel="noreferrer noopener">
            {inline(mm[1]!, key)}
          </a>
        ) : (
          <span key={key}>{mm[1]}</span>
        ),
      );
    } else if (m[5]) {
      const href = tok.slice(1, -1);
      out.push(
        <a key={key} href={href} rel="noreferrer noopener">
          {href}
        </a>,
      );
    } else if (m[6] || m[7]) out.push(<em key={key}>{inline(tok.slice(1, -1), key)}</em>);
    else
      out.push(
        <a key={key} href={tok} rel="noreferrer noopener">
          {tok}
        </a>,
      );
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type ListNode = { ordered: boolean; items: { text: string; children: ListNode[] }[] };

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const isTableSep = (l: string) =>
  /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes("-");
const splitRow = (l: string) =>
  l
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

function buildList(lines: string[], start: number): { node: ListNode; next: number } {
  const first = LIST_RE.exec(lines[start]!)!;
  const baseIndent = first[1]!.length;
  const node: ListNode = { ordered: /\d/.test(first[2]!), items: [] };
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    const m = LIST_RE.exec(line);
    if (m && m[1]!.length === baseIndent) {
      node.items.push({ text: m[3]!, children: [] });
      i++;
    } else if (m && m[1]!.length > baseIndent && node.items.length) {
      const sub = buildList(lines, i);
      node.items[node.items.length - 1]!.children.push(sub.node);
      i = sub.next;
    } else if (/^\s{2,}\S/.test(line) && node.items.length && !m) {
      node.items[node.items.length - 1]!.text += " " + line.trim(); // wrapped item text
      i++;
    } else break;
  }
  return { node, next: i };
}

function renderList(n: ListNode, key: string): ReactNode {
  const Tag = n.ordered ? "ol" : "ul";
  return (
    <Tag key={key}>
      {n.items.map((it, idx) => (
        <li key={idx}>
          {inline(it.text, `${key}-${idx}`)}
          {it.children.map((c, ci) => renderList(c, `${key}-${idx}-${ci}`))}
        </li>
      ))}
    </Tag>
  );
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const key = `b${k++}`;
    if (!line.trim()) {
      i++;
      continue;
    }

    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) body.push(lines[i++]!);
      i++;
      blocks.push(
        <pre key={key}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      const level = Math.min(h[1]!.length, 4);
      const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";
      blocks.push(<Tag key={key}>{inline(h[2]!, key)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push(<hr key={key} />);
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) q.push(lines[i++]!.replace(/^\s*>\s?/, ""));
      blocks.push(
        <blockquote key={key}>
          <p>{inline(q.join(" "), key)}</p>
        </blockquote>,
      );
      continue;
    }
    if (LIST_RE.test(line)) {
      const { node, next } = buildList(lines, i);
      blocks.push(renderList(node, key));
      i = next;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]!)) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) rows.push(splitRow(lines[i++]!));
      blocks.push(
        <div key={key} className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                {head.map((c, ci) => (
                  <th key={ci}>{inline(c, `${key}h${ci}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci}>{inline(c, `${key}r${ri}c${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    // paragraph: gather until a blank line or another block starts
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^\s*```/.test(lines[i]!) &&
      !/^#{1,6}\s/.test(lines[i]!) &&
      !LIST_RE.test(lines[i]!) &&
      !/^\s*>/.test(lines[i]!)
    )
      para.push(lines[i++]!.trim());
    blocks.push(<p key={key}>{inline(para.join(" "), key)}</p>);
  }
  return <div className={styles.md}>{blocks}</div>;
}
