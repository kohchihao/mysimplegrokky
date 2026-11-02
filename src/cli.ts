// cli.ts: grokky new <name> | list | chat <name> [--fresh]

import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createBot, listBots, getBotDir, readBot, readSession, writeSession, clearSession } from "./bots.js";
import { buildSystemAppend } from "./prompt.js";
import { startAgent } from "./acp.js";

const [cmd, name, ...flags] = process.argv.slice(2);
const rl = readline.createInterface({ input: stdin, output: stdout });

// new: instructions are read line by line until an empty line.
async function newBot() {
  console.log("Instructions (end with an empty line):");
  const lines: string[] = [];
  for await (const line of rl) { if (!line.trim()) break; lines.push(line); }
  console.log(`Created ${createBot(name!, lines.join("\n"))}`);
}

function list() {
  const bots = listBots();
  if (!bots.length) return console.log("No bots yet. Try: grokky new <name>");
  for (const b of bots) console.log(`${b.name}  (created ${b.createdAt.slice(0, 10)})`);
}

// chat: one agent process per chat. cwd = the bot folder, so Claude Code can edit
// MEMORY.md and workspace/ without leaving its working directory.
async function chat() {
  const bot = readBot(name!);
  const dir = getBotDir(name!);
  const system = buildSystemAppend(dir);
  const agent = await startAgent({ cwd: dir, rl });

  // Resume the saved session unless --fresh. If load fails, fall back to a new session.
  let sessionId: string | undefined;
  const saved = flags.includes("--fresh") ? (clearSession(name!), null) : readSession(name!);
  if (saved) {
    try { sessionId = await agent.loadSession(saved.sessionId, dir, system); console.log("(resumed session)"); }
    catch { console.log("(could not resume, starting fresh)"); }
  }
  sessionId ??= await agent.newSession(dir, system);
  writeSession(name!, sessionId);

  // Ctrl-C: while a turn runs it sends session/cancel (the turn ends with "cancelled");
  // at the you> prompt it quits. This POC can't steer mid-turn: a new message waits.
  let busy = false;
  rl.on("SIGINT", () => {
    if (busy) { void agent.cancel(sessionId!); console.log("\n(cancelling…)"); }
    else { agent.close(); rl.close(); process.exit(0); }
  });

  console.log(`Chatting with ${bot.name}. /exit to quit.`);
  while (true) {
    const text = (await rl.question("\nyou> ")).trim();
    if (text === "/exit") break;
    if (!text) continue;
    stdout.write(`${bot.name}> `);
    busy = true;
    try { console.log(`\n[${await agent.prompt(sessionId, text)}]`); }
    catch (e) { console.error(`\n[error] ${(e as Error).message}`); }
    finally { busy = false; }
  }
  agent.close();
}

async function main() {
  if (cmd === "list") list();
  else if (cmd === "new" && name) await newBot();
  else if (cmd === "chat" && name) await chat();
  else console.log("Usage: grokky new <name> | list | chat <name> [--fresh]");
  rl.close();
}

main().catch((e) => { console.error((e as Error).message); process.exit(1); });
