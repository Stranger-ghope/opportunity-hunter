/**
 * Email Source Agent — connects via IMAP to parse job alert emails.
 * Works with Gmail app passwords, Outlook, or any IMAP provider.
 */

import Imap from "imap";
import { Readable } from "stream";
import { simpleParser, ParsedMail } from "mailparser";
import { v4 as uuidv4 } from "uuid";
import type { Opportunity } from "../../types";
import { logger } from "../../utils/logger";
import { db } from "../../memory/database";

interface EmailConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  inbox?: string;
  filterSender?: string;
  maxMessages?: number;
}

function buildEmailConfig(): EmailConfig | null {
  const user = process.env.EMAIL_USER;
  const password = process.env.EMAIL_PASSWORD;
  const host = process.env.EMAIL_HOST;

  if (!user || !password || !host) {
    logger.warn("[Email Agent] EMAIL_USER, EMAIL_PASSWORD, or EMAIL_HOST not set — skipping");
    return null;
  }

  return {
    host,
    port: parseInt(process.env.EMAIL_PORT || "993", 10),
    user,
    password,
    tls: process.env.EMAIL_TLS !== "false",
    inbox: process.env.EMAIL_INBOX || "INBOX",
    filterSender: process.env.EMAIL_FILTER_SENDER,
    maxMessages: 20,
  };
}

export async function runEmailAgent(): Promise<Opportunity[]> {
  const config = buildEmailConfig();
  if (!config) return [];

  logger.info("[Email Agent] Connecting to IMAP...");

  try {
    const emails = await fetchEmails(config);
    const results: Opportunity[] = [];

    for (const mail of emails) {
      const opp = parseEmailToOpportunity(mail, config);
      if (opp) results.push(opp);
    }

    logger.info(`[Email Agent] Parsed ${results.length} new opportunities from email`);
    return results;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[Email Agent] Failed: ${msg}`);
    return [];
  }
}

async function fetchEmails(config: EmailConfig): Promise<ParsedMail[]> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: config.user,
      password: config.password,
      host: config.host,
      port: config.port,
      tls: config.tls,
      tlsOptions: { rejectUnauthorized: false },
    });

    const emails: ParsedMail[] = [];

    imap.once("ready", () => {
      imap.openBox(config.inbox || "INBOX", true, (err, box) => {
        if (err) { imap.end(); reject(err); return; }

        // Search for recent unread emails (last 7 days)
        const since = new Date();
        since.setDate(since.getDate() - 7);

        const searchCriteria: (string | string[])[] = [
          "UNSEEN",
          ["SINCE", since.toDateString()],
        ];

        if (config.filterSender) {
          searchCriteria.push(["FROM", config.filterSender]);
        }

        imap.search(searchCriteria, (searchErr, uids) => {
          if (searchErr) { imap.end(); reject(searchErr); return; }
          if (!uids || uids.length === 0) { imap.end(); resolve([]); return; }

          const limited = uids.slice(-config.maxMessages!);
          const fetch = imap.fetch(limited, { bodies: "" });

          fetch.on("message", (msg) => {
            msg.on("body", (stream) => {
              simpleParser(stream as unknown as Readable, (parseErr, mail) => {
                if (!parseErr) emails.push(mail);
              });
            });
          });

          fetch.once("end", () => {
            imap.end();
          });
        });
      });
    });

    imap.once("end", () => resolve(emails));
    imap.once("error", reject);
    imap.connect();
  });
}

function parseEmailToOpportunity(mail: ParsedMail, config: EmailConfig): Opportunity | null {
  const subject = mail.subject || "Email Opportunity";

  // Build a synthetic URL from message ID to detect duplicates
  const syntheticUrl = `email:${config.user}:${mail.messageId || subject}`;
  if (db.opportunityExistsByUrl(syntheticUrl)) return null;

  const bodyText =
    typeof mail.text === "string"
      ? mail.text
      : mail.html
      ? mail.html.replace(/<[^>]+>/g, " ")
      : "";

  const rawText = `${subject}\n\n${bodyText}`.slice(0, 5000);

  return {
    id: uuidv4(),
    title: subject,
    source: `email:${mail.from?.text || config.filterSender || "unknown"}`,
    url: syntheticUrl,
    budget: extractBudget(rawText),
    skills: extractSkills(rawText),
    timestamp: mail.date?.toISOString() || new Date().toISOString(),
    raw_text: rawText,
    status: "new",
  };
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function extractBudget(text: string): string {
  const m = text.match(/\$[\d,]+(?:\s*[-–\/]\s*(?:hr|hour|month|mo))?\b/i);
  return m ? m[0].trim() : "";
}

function extractSkills(text: string): string[] {
  const SKILLS = [
    "TypeScript", "JavaScript", "Python", "Rust", "Go", "Solidity",
    "React", "Node.js", "Docker", "AWS", "Web3", "AI", "ML",
    "LLM", "ElizaOS", "LangChain",
  ];
  const lower = text.toLowerCase();
  return SKILLS.filter((s) => lower.includes(s.toLowerCase()));
}
