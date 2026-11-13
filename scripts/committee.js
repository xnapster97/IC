// Command line for "Claude Code mode".
//   node scripts/committee.js import <file.json>   create a session from rounds written by Claude Code
//   node scripts/committee.js reply <file.json>    add seat replies: { "sessionId": "...", "replies": [{ "speaker": "buffett", "text": "..." }] }
//   node scripts/committee.js open                 list unanswered questions from the Head of IC
//   node scripts/committee.js show <sessionId>     print a session summary (for Claude Code to read)
import fs from "node:fs";
import { importSession, addReplies, openQuestions } from "../src/importer.js";
import { sessions } from "../src/store.js";

const [cmd, arg] = process.argv.slice(2);
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

if (cmd === "import") {
  const s = importSession(readJson(arg));
  console.log(`Imported ${s.id}: ${s.title} — committee says ${s.verdict.recommendation}`);
} else if (cmd === "reply") {
  const s = addReplies(readJson(arg));
  console.log(`Added replies to ${s.id}`);
} else if (cmd === "open") {
  let any = false;
  for (const meta of sessions.list()) {
    const qs = openQuestions(sessions.get(meta.id));
    if (!qs.length) continue;
    any = true;
    console.log(`\n${meta.id} — ${meta.title}`);
    qs.forEach((q) => console.log(`  [${q.at.slice(0, 16)}] ${q.text}`));
  }
  if (!any) console.log("No open questions.");
} else if (cmd === "show") {
  const s = sessions.get(arg);
  if (!s) throw new Error("Session not found");
  console.log(JSON.stringify({ title: s.title, verdict: s.verdict, decision: s.decision, chat: s.chat, final: s.rounds.final }, null, 2));
} else {
  console.log("Usage: node scripts/committee.js import|reply|open|show ...");
}
