// bots.ts: plain-file bot storage. No database: the folder IS the bot.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Bot = { name: string; instructions: string; createdAt: string };
export type Session = { sessionId: string; updatedAt: string };

// data/ sits in the project (git-ignored) so you can open each bot's files in your editor.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = path.resolve(ROOT, "data");

export const slugify = (name: string) =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export const getBotDir = (name: string) => path.join(DATA_DIR, slugify(name));

// One folder per bot: bot.json (who it is), MEMORY.md (durable memory, written by the bot
// itself), session.json (which Claude Code session to resume), workspace/ (its scratch files).
export function createBot(name: string, instructions: string): string {
  const slug = slugify(name);
  if (!slug) throw new Error("Bot name needs at least one letter or digit");
  const dir = getBotDir(name);
  if (fs.existsSync(dir)) throw new Error(`Bot "${slug}" already exists`);
  fs.mkdirSync(path.join(dir, "workspace"), { recursive: true });
  const bot: Bot = { name, instructions, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, "bot.json"), JSON.stringify(bot, null, 2));
  fs.writeFileSync(path.join(dir, "MEMORY.md"), "");
  return dir;
}

export function readBot(name: string): Bot {
  const file = path.join(getBotDir(name), "bot.json");
  if (!fs.existsSync(file)) throw new Error(`No bot named "${slugify(name)}"`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function listBots(): Bot[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR)
    .filter((d) => fs.existsSync(path.join(DATA_DIR, d, "bot.json")))
    .map((d) => readBot(d));
}

// session.json is the only link between the CLI and Claude Code's own transcript store.
// Delete it (or pass --fresh) and the next chat starts a new session.
const sessionFile = (name: string) => path.join(getBotDir(name), "session.json");

export function readSession(name: string): Session | null {
  try { return JSON.parse(fs.readFileSync(sessionFile(name), "utf8")); } catch { return null; }
}

export function writeSession(name: string, sessionId: string) {
  const s: Session = { sessionId, updatedAt: new Date().toISOString() };
  fs.writeFileSync(sessionFile(name), JSON.stringify(s, null, 2));
}

export function clearSession(name: string) {
  fs.rmSync(sessionFile(name), { force: true });
}
