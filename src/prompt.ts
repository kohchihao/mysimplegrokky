// prompt.ts: builds the per-bot text appended to Claude Code's system prompt.

import fs from "node:fs";
import path from "node:path";
import type { Bot } from "./bots.js";

// This is a SNAPSHOT taken when a session starts or loads. If the bot edits MEMORY.md
// mid-chat, the session already knows (it made the edit) but the prompt text is stale until
// the next start. Session context = this conversation; MEMORY.md = what survives --fresh.
/** Text appended to Claude Code's own system prompt at session start. */
export function buildSystemAppend(botDir: string): string {
  const bot: Bot = JSON.parse(fs.readFileSync(path.join(botDir, "bot.json"), "utf8"));
  const memPath = path.join(botDir, "MEMORY.md");
  const memory = fs.existsSync(memPath) ? fs.readFileSync(memPath, "utf8").trim() : "";
  return [
    `# You are ${bot.name}`,
    bot.instructions,
    `# Your memory`,
    `Your durable memory lives in ${memPath}. Current contents:`,
    memory ? `<memory>\n${memory}\n</memory>` : "(empty)",
    // The bot writes its own memory with Claude Code's normal file tools. The ~150-line cap
    // is only an instruction; nothing enforces it (Codync uses a separate summariser pass).
    `# Memory rules`,
    `- When you learn a lasting fact or preference, update MEMORY.md with your file tools.`,
    `- Keep it under ~150 lines: merge duplicates, delete stale entries.`,
    `- Never store secrets or one-off task details.`,
    `- Put any files you create in ./workspace/.`,
  ].join("\n\n");
}
