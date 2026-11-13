// "Claude Code mode": a committee session written by Claude Code in the chat (using the owner's Claude plan,
// no API key needed) is imported from a JSON file and turned into a normal session the app can show.
import { loadPersonas } from "./personas.js";
import { tally } from "./committee.js";
import { sessions as store } from "./store.js";

const VOTES = ["BUY", "HOLD", "SELL"];
const now = () => new Date().toISOString();

function checkCard(who, c, round) {
  if (!c) throw new Error(`${who}: missing ${round} card`);
  if (!VOTES.includes(c.vote)) throw new Error(`${who}: ${round} vote must be BUY/HOLD/SELL`);
  if (![1, 2, 3, 4, 5].includes(c.conviction)) throw new Error(`${who}: ${round} conviction must be 1-5`);
  return {
    keyRisks: [], missingFacts: [], positions: [], changeMyMind: "",
    fairValue: { bear: null, base: null, bull: null },
    ...c,
  };
}

/** Build a full session from the rounds written by Claude Code. */
export function importSession(input) {
  const byId = Object.fromEntries(loadPersonas().map((p) => [p.id, p]));
  const members = input.members || Object.keys(input.blind);
  for (const id of members) if (!byId[id]) throw new Error(`Unknown seat id: ${id}`);

  const date = (input.date || now()).slice(0, 10);
  const s = {
    id: input.id || `${date}-${(input.idea.ticker || "idea").toLowerCase().replace(/[^a-z0-9]+/g, "")}-cc`,
    title: input.title || `${input.idea.proposedAction || "BUY"} ${input.idea.ticker} — ${input.idea.name}`,
    type: input.type || "idea",
    idea: input.idea,
    members,
    mode: "claude-code",
    status: "awaiting_decision",
    currentRound: "final",
    createdAt: input.date || now(),
    rounds: { facts: input.facts, blind: {}, roast: {}, final: {} },
    minutes: [],
    chat: [],
    verdict: null,
    decision: null,
    errors: [],
  };
  const minute = (round, speaker, text) => s.minutes.push({ at: s.createdAt, round, speaker, text });

  minute("facts", "secretary", "The dossier is on the table. Each seat now writes a blind card — no peeking at the others.");
  for (const id of members) {
    const c = (s.rounds.blind[id] = checkCard(id, input.blind[id], "blind"));
    minute("blind", id, `${c.vote} · c${c.conviction} — ${c.headline}`);
  }
  const t1 = tally(s.rounds.blind);
  const fv = t1.median != null ? ` Base-case fair values range ${t1.min}–${t1.max}, median ${t1.median}.` : "";
  minute("blind", "secretary", `Vote after blind cards: ${t1.votes.BUY} BUY, ${t1.votes.HOLD} HOLD, ${t1.votes.SELL} SELL.${fv}${t1.unanimous ? " Herd alarm: the vote is unanimous." : ""}`);

  for (const id of members) {
    const r = input.roast?.[id];
    if (!r) continue;
    if (!members.includes(r.target) || r.target === id) throw new Error(`${id}: invalid roast target ${r.target}`);
    s.rounds.roast[id] = r;
    minute("roast", id, `@${byId[r.target].name}: ${r.critique}`);
  }
  for (const id of members) {
    const f = (s.rounds.final[id] = checkCard(id, input.final[id], "final"));
    f.changedMind = f.changedMind ?? f.vote !== s.rounds.blind[id].vote;
    minute("rebuttal", id, f.rebuttal || "");
  }
  for (const id of members) {
    const f = s.rounds.final[id];
    minute("final", id, `${f.vote} · c${f.conviction}${f.changedMind ? " (changed)" : ""} — ${f.headline}`);
  }
  const t2 = tally(s.rounds.final);
  s.verdict = { ...input.verdict, tally: t2, blindTally: t1 };
  minute("final", "secretary", `Verdict: ${s.verdict.recommendation} — ${s.verdict.consensus}. ${s.verdict.summary} The decision now rests with the Head of IC.`);
  store.save(s);
  return s;
}

/** Add replies written by Claude Code to questions the Head of IC asked in the minutes. */
export function addReplies({ sessionId, replies }) {
  const s = store.get(sessionId);
  if (!s) throw new Error(`Session not found: ${sessionId}`);
  for (const r of replies) {
    s.chat.push({ at: now(), speaker: r.speaker, text: r.text });
    s.minutes.push({ at: now(), round: s.currentRound, speaker: r.speaker, text: r.text });
  }
  s.updatedAt = now();
  store.save(s);
  return s;
}

/** Questions from the Head of IC that have not been answered yet (asked after the last seat reply). */
export function openQuestions(s) {
  const lastReply = s.chat.map((m) => m.speaker !== "hollmann" && !m.pending).lastIndexOf(true);
  return s.chat.slice(lastReply + 1).filter((m) => m.speaker === "hollmann");
}
