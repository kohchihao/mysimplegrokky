// acp.ts: the ACP client. Spawns an agent process and talks Agent Client Protocol to it.

import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type { Interface } from "node:readline/promises";
import * as acp from "@agentclientprotocol/sdk";

// The agent handle cli.ts uses: start once per chat, then drive sessions with it.
export type Agent = Awaited<ReturnType<typeof startAgent>>;

export async function startAgent({ cwd, rl }: { cwd: string; rl: Interface }) {
  // The ONLY Claude-specific line. claude-agent-acp is an adapter: it speaks ACP on
  // stdin/stdout and drives Claude Code (via the Claude Agent SDK) underneath. It uses
  // your existing `claude /login`. Swap this for any other ACP agent (Gemini CLI, Codex…).
  // stderr is inherited so adapter logs show in your terminal, not on the protocol pipe.
  const child = spawn("npx", ["-y", "@agentclientprotocol/claude-agent-acp"], {
    cwd, stdio: ["pipe", "pipe", "inherit"], env: process.env,
  });
  // ACP = JSON-RPC 2.0, one JSON message per line (ndjson) over the child's stdio.
  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
  );
  // session/load re-sends the whole history as session/update notifications; we mute it.
  let quiet = false; // true while session/load replays old history

  // SDK v2 builder API: register handlers for what the AGENT may call on US, then connect.
  // (Older docs show ClientSideConnection + a Client interface; that's the v1 SDK API.)
  const conn = acp.client({ name: "grokky" })
    // session/update is a notification (no reply). Variants include agent_message_chunk,
    // agent_thought_chunk, tool_call, tool_call_update, plan, usage_update, ... We print
    // only text chunks and tool-call titles; everything else is ignored.
    .onNotification(acp.methods.client.session.update, ({ params: { update: u } }) => {
      if (quiet) return;
      if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text")
        process.stdout.write(u.content.text);
      else if (u.sessionUpdate === "tool_call")
        process.stdout.write(`\n[tool] ${u.title}\n`);
    })
    // session/request_permission is a request: the agent blocks until we answer. It
    // offers options, each with an optionId and a kind (allow_once / allow_always /
    // reject_once / reject_always). We pick one by kind and reply with its optionId,
    // or answer "cancelled".
    .onRequest(acp.methods.client.session.requestPermission, async ({ params: req }) => {
      const ans = await rl.question(`\nAllow "${req.toolCall.title ?? "tool"}"? [y/n] `);
      const kind: acp.PermissionOptionKind = /^y/i.test(ans.trim()) ? "allow_once" : "reject_once";
      const opt = req.options.find((o) => o.kind === kind);
      return opt
        ? { outcome: { outcome: "selected", optionId: opt.optionId } }
        : { outcome: { outcome: "cancelled" } };
    })
    .connect(stream);
  // .connect() (not connectWith) keeps the connection open for the whole chat.
  const agent = conn.agent;

  // initialize: agree on the protocol version and swap capabilities. We say we offer no
  // fs/terminal, so Claude Code uses its own file and shell tools. The agent answers with
  // agentCapabilities (e.g. loadSession, sessionCapabilities.resume).
  const init = await agent.request(acp.methods.agent.initialize, {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: "grokky", version: "0.0.1" },
  });
  // _meta is ACP's extension slot. systemPrompt.append is specific to the Claude adapter:
  // the text is appended to the built-in claude_code preset prompt (a plain string would
  // replace it). It is sent ONCE, at session start. Later turns send only the new message,
  // so the prompt prefix stays byte-identical and Anthropic's prompt cache stays warm.
  const meta = (append: string) => ({ systemPrompt: { append } });

  return {
    canLoad: init.agentCapabilities?.loadSession === true,

    // session/new: a fresh conversation. cwd is where Claude Code's tools operate.
    async newSession(cwd: string, systemAppend: string) {
      const s = await agent.request(acp.methods.agent.session.new, { cwd, mcpServers: [], _meta: meta(systemAppend) });
      return s.sessionId;
    },

    // session/load: reopen a saved conversation; the agent replays the history to us.
    // session/resume (also advertised) reopens without replay; we use load as the v1-stable one.
    // We send the system prompt again because the adapter rebuilds its options on load.
    async loadSession(sessionId: string, cwd: string, systemAppend: string) {
      if (!this.canLoad) throw new Error("agent cannot load sessions");
      quiet = true;
      try {
        await agent.request(acp.methods.agent.session.load, { sessionId, cwd, mcpServers: [], _meta: meta(systemAppend) });
      } finally { quiet = false; }
      return sessionId;
    },

    // session/prompt: one turn. It resolves only when the turn ends; the text streams in
    // via session/update meanwhile. stopReason: end_turn | max_tokens |
    // max_turn_requests | refusal | cancelled.
    async prompt(sessionId: string, text: string) {
      const r = await agent.request(acp.methods.agent.session.prompt, { sessionId, prompt: [{ type: "text", text }] });
      return r.stopReason;
    },

    // session/cancel is a notification. The pending prompt then resolves with stopReason "cancelled".
    cancel: (sessionId: string) => agent.notify(acp.methods.agent.session.cancel, { sessionId }),

    close() { conn.close(); child.kill(); },
  };
}
