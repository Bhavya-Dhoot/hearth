import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import type { Logger } from "../log";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Short id used in the outbox file name, for example the order id. */
  tag: string;
}

export type EmailStatus = "sent" | "written_to_outbox";

export interface EmailService {
  send(message: EmailMessage): Promise<EmailStatus>;
}

/* ------------------------------------------------------------------ .eml outbox */

const FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.eml$/;
export const isOutboxFileName = (name: string): boolean => FILE_PATTERN.test(name);

const needsEncoding = (s: string): boolean => /[^\x20-\x7e]/.test(s);
const encodeHeader = (s: string): string => (needsEncoding(s) ? `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=` : s);
function decodeHeader(s: string): string {
  return s.replace(/=\?UTF-8\?B\?([^?]*)\?=/gi, (_m, b64: string) => Buffer.from(b64, "base64").toString("utf8"));
}

export function buildEml(message: EmailMessage, from: string, date: Date): string {
  const boundary = `hearth-${randomBytes(8).toString("hex")}`;
  const headers = [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${message.tag}.${randomBytes(6).toString("hex")}@hearth.example>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type: string, body: string): string =>
    [`--${boundary}`, `Content-Type: ${type}; charset=utf-8`, "Content-Transfer-Encoding: 8bit", "", body].join("\r\n");
  return [headers.join("\r\n"), "", part("text/plain", message.text), part("text/html", message.html), `--${boundary}--`, ""].join("\r\n");
}

export interface OutboxEntry {
  file: string;
  from: string;
  to: string;
  subject: string;
  date: string;
}

export interface OutboxMessage extends OutboxEntry {
  text: string;
  html: string;
}

function headerValue(head: string, name: string): string {
  const m = new RegExp(`^${name}:[ \\t]*(.*)$`, "im").exec(head);
  return decodeHeader(m?.[1]?.trim() ?? "");
}

export function parseEml(file: string, raw: string): OutboxMessage {
  const split = raw.indexOf("\r\n\r\n");
  const head = split === -1 ? raw : raw.slice(0, split);
  const body = split === -1 ? "" : raw.slice(split + 4);
  const boundary = /boundary="([^"]+)"/i.exec(head)?.[1];
  let text = "";
  let html = "";
  if (boundary) {
    for (const chunk of body.split(`--${boundary}`)) {
      const at = chunk.indexOf("\r\n\r\n");
      if (at === -1) continue;
      const partHead = chunk.slice(0, at);
      const partBody = chunk.slice(at + 4).replace(/\r\n$/, "");
      if (/content-type:\s*text\/html/i.test(partHead)) html = partBody;
      else if (/content-type:\s*text\/plain/i.test(partHead)) text = partBody;
    }
  }
  return {
    file,
    from: headerValue(head, "From"),
    to: headerValue(head, "To"),
    subject: headerValue(head, "Subject"),
    date: headerValue(head, "Date"),
    text,
    html,
  };
}

export async function listOutbox(dir: string): Promise<OutboxEntry[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const entries: OutboxEntry[] = [];
  for (const name of names.filter(isOutboxFileName).sort().reverse()) {
    const { text: _text, html: _html, ...entry } = parseEml(name, await readFile(path.join(dir, name), "utf8"));
    entries.push(entry);
  }
  return entries;
}

export async function readOutboxMessage(dir: string, file: string): Promise<OutboxMessage | null> {
  if (!isOutboxFileName(file)) return null;
  try {
    return parseEml(file, await readFile(path.join(dir, file), "utf8"));
  } catch {
    return null;
  }
}

export function createOutboxEmail(dir: string, from: string, now: () => Date): EmailService {
  return {
    async send(message) {
      await mkdir(dir, { recursive: true });
      const at = now();
      const stamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      const safeTag = message.tag.replace(/[^A-Za-z0-9_-]/g, "");
      const file = `${stamp}-${safeTag || "message"}-${randomBytes(3).toString("hex")}.eml`;
      await writeFile(path.join(dir, file), buildEml(message, from, at), "utf8");
      return "written_to_outbox";
    },
  };
}

/** Resend when a key is configured; any provider failure falls back to the outbox so the order is never lost. */
export function createResendEmail(apiKey: string, from: string, fallback: EmailService, logger: Logger): EmailService {
  const client = new Resend(apiKey);
  return {
    async send(message) {
      try {
        const { error } = await client.emails.send({ from, to: message.to, subject: message.subject, text: message.text, html: message.html });
        if (!error) return "sent";
        logger.error("resend_rejected", { name: error.name, message: error.message });
      } catch (err) {
        logger.error("resend_failed", { message: err instanceof Error ? err.message : String(err) });
      }
      return fallback.send(message);
    },
  };
}
