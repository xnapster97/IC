// The committee process. One session = one idea (or the portfolio) going through five rounds:
//   0 Facts      – the Secretary researches and writes the dossier
//   1 Blind cards – every seat votes independently, without seeing the others
//   2 Roast      – every seat attacks the weakest card of another seat
//   3 Rebuttal   – every seat answers the attacks on its own card
//   4 Final vote – every seat votes again; the Secretary writes the verdict
// Then the Head of IC (the human) decides.
import { EventEmitter } from "node:events";
import { loadPersonas } from "./personas.js";
import { ask, isLive, WEB_RESEARCH } from "./llm.js";
import { sessions as store, portfolio as portfolioStore } from "./store.js";
import * as demo from "./demo.js";

export const events = new EventEmitter();
events.setMaxListeners(100);

export const ROUNDS = [
  { key: "facts", label: "0 · Facts" },
  { key: "blind", label: "1 · Blind cards" },
  { key: "roast", label: "2 · Roast" },
  { key: "rebuttal", label: "3 · Rebuttal" },
  { key: "final", label: "4 · Final vote" },
];

const RULES = `You are one seat in a simulated investment committee that advises a private investor (the Head of IC).
You reason the way the investor described under "Your seat" is publicly known to reason.
- You are a simulation built from public material. Never claim to be the real person, never invent quotes, never claim private knowledge of their current trades.
- Write in English. Be concise and concrete. Stay in character, but be genuinely useful to the decision maker.
- Use the numbers in the dossier. If you need a number that is not there, list it under missing facts instead of inventing it.
- Fair values are per share, in the currency of the dossier. Use null when you cannot estimate responsibly.
- This is decision support for the Head of IC, not financial advice.`;

const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] };
const strList = { type: "array", items: { type: "string" } };

const cardProps = {
  vote: { type: "string", enum: ["BUY", "HOLD", "SELL"] },
  conviction: { type: "integer", enum: [1, 2, 3, 4, 5] },
  headline: { type: "string", description: "Your position in one sentence, max 25 words, in your own voice." },
  thesis: { type: "string", description: "Your reasoning, max 120 words." },
  keyRisks: { ...strList, description: "2-4 risks, max 20 words each." },
  changeMyMind: { type: "string", description: "The one fact that would change your vote." },
  fairValue: {
    type: "object",
    additionalProperties: false,
    required: ["bear", "base", "bull"],
    properties: { bear: nullableNumber, base: nullableNumber, bull: nullableNumber },
  },
  missingFacts: strList,
  positions: {
    type: "array",
    description: "Portfolio reviews only: one entry per holding. Empty array for single-stock sessions.",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["ticker", "action", "comment"],
      properties: {
        ticker: { type: "string" },
        action: { type: "string", enum: ["ADD", "HOLD", "TRIM", "SELL"] },
        comment: { type: "string" },
      },
    },
  },
};
const cardSchema = { type: "object", additionalProperties: false, required: Object.keys(cardProps), properties: cardProps };

const finalSchema = {
  type: "object",
  additionalProperties: false,
  required: ["rebuttal", "changedMind", ...Object.keys(cardProps)],
  properties: {
    rebuttal: { type: "string", description: "Your answer to the attacks on your card, max 90 words." },
    changedMind: { type: "boolean" },
    ...cardProps,
  },
};

const roastSchema = (targets) => ({
  type: "object",
  additionalProperties: false,
  required: ["target", "critique"],
  properties: {
    target: { type: "string", enum: targets },
    critique: { type: "string", description: "Your attack on that seat's card, max 80 words, in your own voice." },
  },
});

const verdictSchema = {
  type: "object",
  additionalProperties: false,
  required: ["recommendation", "consensus", "summary", "agreements", "disagreements", "keyRisks", "openQuestions", "positionSizing", "herdAlarm"],
  properties: {
    recommendation: { type: "string", enum: ["BUY", "HOLD", "SELL"] },
    consensus: { type: "string", description: "e.g. 'Consensus BUY (6-2-1)' or 'Split committee'." },
    summary: { type: "string", description: "Max 150 words." },
    agreements: strList,
    disagreements: strList,
    keyRisks: strList,
    openQuestions: strList,
    positionSizing: { type: "string" },
    herdAlarm: { type: "boolean" },
  },
};

// ---------- helpers ----------

const now = () => new Date().toISOString();

function persist(s) {
  s.updatedAt = now();
  store.save(s);
  events.emit(s.id, s);
}

function minute(s, round, speaker, text) {
  s.minutes.push({ at: now(), round, speaker, text });
}

async function pool(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

function seatSystem(persona, head) {
  return `${RULES}\n\n# Your seat\n${persona.prompt}\n\n# Mandate of the Head of IC (binding context)\n${head.prompt}`;
}

function cardText(name, c) {
  if (!c || c.error) return `${name}: (no card)`;
  const fv = c.fairValue ? `fair value bear/base/bull ${c.fairValue.bear ?? "–"}/${c.fairValue.base ?? "–"}/${c.fairValue.bull ?? "–"}` : "";
  const pos = c.positions?.length ? `\n  Positions: ${c.positions.map((p) => `${p.ticker} ${p.action}`).join(", ")}` : "";
  return `${name}: ${c.vote} (conviction ${c.conviction}) — ${c.headline}\n  Thesis: ${c.thesis}\n  Risks: ${(c.keyRisks || []).join("; ")}\n  ${fv}${pos}`;
}

function headNotes(s) {
  const notes = s.chat.filter((m) => m.speaker === "hollmann").map((m) => `- ${m.text}`);
  return notes.length ? `\n\n# Notes from the Head of IC during this session\n${notes.join("\n")}` : "";
}

function context(s) {
  return `# Topic\n${s.title}\n\n# Idea as submitted\n${s.idea.thesis || "(none)"}\n\n# Dossier (round 0)\n${s.rounds.facts?.text || "(no dossier)"}${headNotes(s)}`;
}

export function tally(cards) {
  const valid = Object.values(cards || {}).filter((c) => c && !c.error);
  const votes = { BUY: 0, HOLD: 0, SELL: 0 };
  valid.forEach((c) => votes[c.vote]++);
  const bases = valid.map((c) => c.fairValue?.base).filter((v) => typeof v === "number").sort((a, b) => a - b);
  const median = bases.length ? bases[Math.floor((bases.length - 1) / 2)] : null;
  const spread = bases.length > 1 && median ? (bases[bases.length - 1] - bases[0]) / median : null;
  const max = Math.max(votes.BUY, votes.HOLD, votes.SELL);
  return { votes, count: valid.length, median, min: bases[0] ?? null, max: bases.at(-1) ?? null, spread, unanimous: valid.length > 2 && max === valid.length };
}

// ---------- create & run ----------

export function createSession({ type = "idea", idea, memberIds }) {
  const personas = loadPersonas();
  const members = personas.filter((p) => p.kind === "member" && (!memberIds?.length || memberIds.includes(p.id))).map((p) => p.id);
  let title;
  if (type === "portfolio") {
    const pf = portfolioStore.get();
    const lines = pf.positions.map((p) => `- ${p.ticker} (${p.name}): ${p.shares} shares, avg cost ${p.avgCost} ${p.currency}`);
    idea = {
      ticker: "PORTFOLIO",
      name: "Portfolio review",
      source: "Own portfolio",
      thesis: `Review the current portfolio. Base currency ${pf.baseCurrency}, cash ${pf.cash}.\n${lines.join("\n")}`,
      proposedAction: "HOLD",
    };
    title = `Portfolio review — ${new Date().toISOString().slice(0, 10)}`;
  } else {
    title = `${idea.proposedAction || "BUY"} ${idea.ticker ? idea.ticker + " — " : ""}${idea.name}`;
  }
  const s = {
    id: `${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    type,
    idea,
    members,
    mode: isLive() ? "live" : "demo",
    status: "running",
    currentRound: "facts",
    createdAt: now(),
    rounds: { facts: null, blind: {}, roast: {}, final: {} },
    minutes: [],
    chat: [],
    verdict: null,
    decision: null,
    errors: [],
  };
  persist(s);
  run(s).catch((e) => {
    s.status = "error";
    s.errors.push(String(e.message || e));
    persist(s);
  });
  return s;
}

async function run(s) {
  const personas = loadPersonas();
  const byId = Object.fromEntries(personas.map((p) => [p.id, p]));
  const head = byId.hollmann;
  const secretary = byId.secretary;
  const members = s.members.map((id) => byId[id]).filter(Boolean);
  const live = s.mode === "live";
  const isPortfolio = s.type === "portfolio";

  // ----- Round 0: facts -----
  s.currentRound = "facts";
  persist(s);
  if (live) {
    const research = WEB_RESEARCH ? "Use web search to get the latest price, key financials, recent news and analyst views. " : "";
    const { text, sources } = await ask({
      system: `${RULES}\n\n# Your seat\n${secretary.prompt}`,
      webSearch: WEB_RESEARCH,
      prompt: `${isPortfolio ? "Prepare a fact dossier for a review of this portfolio." : "Prepare the fact dossier for this investment idea."}
${research}Today is ${now().slice(0, 10)}.

Topic: ${s.title}
Idea as submitted (source: ${s.idea.source || "n/a"}):
${s.idea.thesis}

Write a compact dossier in markdown (max 400 words): business in two lines, current price and date, valuation (P/E, EV/EBIT or FCF yield), growth, margins, balance sheet, recent news and catalysts, what the bull and bear camps argue. ${isPortfolio ? "Cover each holding in 2-3 lines plus portfolio-level concentration, currency and sector exposure." : ""}
Only state numbers you found or know with confidence and give the date. Mark anything uncertain.
End with a fenced \`\`\`json block: {"company": str, "ticker": str, "currency": str, "price": number|null, "priceDate": str, "keyFacts": [{"label": str, "value": str}]}`,
    });
    const m = text.match(/```json\s*([\s\S]*?)```/);
    let facts = null;
    try { facts = m ? JSON.parse(m[1]) : null; } catch { /* keep null */ }
    s.rounds.facts = { text: text.replace(/```json[\s\S]*?```/, "").trim(), facts, sources };
  } else {
    s.rounds.facts = demo.facts(s);
  }
  minute(s, "facts", "secretary", "The dossier is on the table. Each seat now writes a blind card — no peeking at the others.");
  persist(s);

  // ----- Round 1: blind cards (parallel, independent) -----
  s.currentRound = "blind";
  persist(s);
  await pool(members, 4, async (p) => {
    try {
      s.rounds.blind[p.id] = live
        ? (await ask({
            system: seatSystem(p, head),
            schema: cardSchema,
            prompt: `${context(s)}\n\n# Your task — Round 1, blind card\nYou have not seen anyone else's view. Give your independent vote on: "${s.title}". ${isPortfolio ? "Fill 'positions' with one entry per holding; 'vote' is your view on adding risk to the portfolio overall." : "Leave 'positions' empty."}`,
          })).data
        : demo.card(p, s, "blind");
      minute(s, "blind", p.id, `${s.rounds.blind[p.id].vote} · c${s.rounds.blind[p.id].conviction} — ${s.rounds.blind[p.id].headline}`);
    } catch (e) {
      s.rounds.blind[p.id] = { error: String(e.message || e) };
      s.errors.push(`${p.name} (blind): ${e.message || e}`);
    }
    persist(s);
  });

  const t1 = tally(s.rounds.blind);
  const fv = t1.median != null ? ` Base-case fair values range ${t1.min}–${t1.max}, median ${t1.median}.` : "";
  const herd = t1.unanimous ? " Herd alarm: the vote is unanimous. I ask every seat to attack the strongest case, not the weakest." : "";
  minute(s, "blind", "secretary", `Vote after blind cards: ${t1.votes.BUY} BUY, ${t1.votes.HOLD} HOLD, ${t1.votes.SELL} SELL.${fv}${herd}`);
  persist(s);

  const allCards = () => members.map((p) => cardText(`${p.name} [id: ${p.id}]`, s.rounds.blind[p.id])).join("\n\n");

  // ----- Round 2: roast -----
  s.currentRound = "roast";
  persist(s);
  await pool(members, 4, async (p) => {
    const targets = members.filter((o) => o.id !== p.id && s.rounds.blind[o.id] && !s.rounds.blind[o.id].error).map((o) => o.id);
    if (!targets.length) return;
    try {
      s.rounds.roast[p.id] = live
        ? (await ask({
            system: seatSystem(p, head),
            schema: roastSchema(targets),
            prompt: `${context(s)}\n\n# All blind cards\n${allCards()}\n\n# Your own card\n${cardText(p.name, s.rounds.blind[p.id])}\n\n# Your task — Round 2, the roast\nPick ONE other seat whose card you find most wrong or most dangerous for the Head of IC, and attack it from your philosophy. Be specific: name the flawed assumption or the missing number.${t1.unanimous ? " The vote is unanimous, so attack the strongest card." : ""}`,
          })).data
        : demo.roast(p, targets, s);
      const target = s.rounds.roast[p.id].target;
      minute(s, "roast", p.id, `@${members.find((m) => m.id === target)?.name}: ${s.rounds.roast[p.id].critique}`);
    } catch (e) {
      s.errors.push(`${p.name} (roast): ${e.message || e}`);
    }
    persist(s);
  });

  // ----- Rounds 3+4: rebuttal and final vote (one call per seat) -----
  s.currentRound = "rebuttal";
  persist(s);
  const roastsText = members
    .filter((p) => s.rounds.roast[p.id])
    .map((p) => `${p.name} attacks ${byId[s.rounds.roast[p.id].target]?.name}: ${s.rounds.roast[p.id].critique}`)
    .join("\n");
  await pool(members, 4, async (p) => {
    const against = members.filter((o) => s.rounds.roast[o.id]?.target === p.id).map((o) => `${o.name}: ${s.rounds.roast[o.id].critique}`);
    try {
      s.rounds.final[p.id] = live
        ? (await ask({
            system: seatSystem(p, head),
            schema: finalSchema,
            prompt: `${context(s)}\n\n# All blind cards\n${allCards()}\n\n# The roast\n${roastsText || "(none)"}\n\n# Attacks on your card\n${against.join("\n") || "Nobody attacked your card. Respond to the attack you find most relevant to your view."}\n\n# Your task — Rounds 3 and 4\n1) 'rebuttal': answer the attacks. Concede what is right.\n2) Then cast your FINAL vote with the full card. Change your vote only if the arguments really moved you, and set 'changedMind' accordingly.${isPortfolio ? " Fill 'positions' with one entry per holding." : " Leave 'positions' empty."}`,
          })).data
        : demo.final(p, s, against);
      const f = s.rounds.final[p.id];
      minute(s, "rebuttal", p.id, f.rebuttal);
      minute(s, "final", p.id, `${f.vote} · c${f.conviction}${f.changedMind ? " (changed)" : ""} — ${f.headline}`);
    } catch (e) {
      s.rounds.final[p.id] = { error: String(e.message || e) };
      s.errors.push(`${p.name} (final): ${e.message || e}`);
    }
    persist(s);
  });
  s.currentRound = "final";
  persist(s);

  // ----- Verdict by the Secretary -----
  const t2 = tally(s.rounds.final);
  const finalCards = members.map((p) => cardText(p.name, s.rounds.final[p.id]) + (s.rounds.final[p.id]?.rebuttal ? `\n  Rebuttal: ${s.rounds.final[p.id].rebuttal}` : "")).join("\n\n");
  s.verdict = live
    ? (await ask({
        system: `${RULES}\n\n# Your seat\n${secretary.prompt}\n\n# Mandate of the Head of IC\n${head.prompt}`,
        schema: verdictSchema,
        prompt: `${context(s)}\n\n# Blind cards\n${allCards()}\n\n# Roast\n${roastsText}\n\n# Final cards\n${finalCards}\n\n# Final tally\n${JSON.stringify(t2)}\n\nWrite the committee verdict for the Head of IC. 'recommendation' follows the majority of final votes unless it is a tie; then pick the more cautious option and say so.`,
      })).data
    : demo.verdict(s, t2);
  s.verdict.tally = t2;
  s.verdict.blindTally = t1;
  minute(s, "final", "secretary", `Verdict: ${s.verdict.recommendation} — ${s.verdict.consensus}. ${s.verdict.summary} The decision now rests with the Head of IC.`);
  s.status = "awaiting_decision";
  persist(s);
}

// ---------- chat during / after a session ----------

export async function askCommittee(s, text) {
  const personas = loadPersonas();
  const byId = Object.fromEntries(personas.map((p) => [p.id, p]));
  s.chat.push({ at: now(), speaker: "hollmann", text });
  minute(s, s.currentRound, "hollmann", text);
  persist(s);

  // Claude Code mode without an API key: the question waits until Claude Code answers it in the chat.
  if (!isLive() && s.mode === "claude-code") {
    const note = "Question recorded. To get the seats' answers for free, tell Claude Code: \"Answer the open questions in the committee.\"";
    s.chat.push({ at: now(), speaker: "secretary", text: note, pending: true });
    minute(s, s.currentRound, "secretary", note);
    persist(s);
    return s;
  }

  // "@Buffett", "@Ken Griffin", "@all"
  const lower = text.toLowerCase();
  let targets = personas.filter((p) => p.kind === "member" && s.members.includes(p.id) &&
    (lower.includes("@" + p.id) || lower.includes("@" + p.name.toLowerCase()) || lower.includes("@" + p.name.split(" ").at(-1).toLowerCase())));
  if (lower.includes("@all")) targets = s.members.map((id) => byId[id]).filter(Boolean);
  if (!targets.length) targets = [byId.secretary];

  const record = members(s, byId);
  await pool(targets, 4, async (p) => {
    let reply;
    try {
      reply = isLive()
        ? (await ask({
            system: p.kind === "secretary" ? `${RULES}\n\n# Your seat\n${p.prompt}` : seatSystem(p, byId.hollmann),
            maxTokens: 4000,
            prompt: `${context(s)}\n\n# Session record so far\n${record}\n\n# The Head of IC says to you\n"${text}"\n\nAnswer directly in max 120 words, in your own voice. If it is a new fact, say whether it changes your vote.`,
          })).text
        : demo.chatReply(p, text);
    } catch (e) {
      reply = `(error: ${e.message || e})`;
    }
    s.chat.push({ at: now(), speaker: p.id, text: reply });
    minute(s, s.currentRound, p.id, reply);
    persist(s);
  });
  return s;
}

function members(s, byId) {
  return s.members
    .map((id) => {
      const card = s.rounds.final[id] && !s.rounds.final[id].error ? s.rounds.final[id] : s.rounds.blind[id];
      return cardText(byId[id]?.name || id, card);
    })
    .join("\n\n");
}

export function decide(s, { vote, note }) {
  s.decision = { vote, note: note || "", at: now() };
  s.status = "closed";
  minute(s, "final", "hollmann", `Decision of the Head of IC: ${vote}.${note ? " " + note : ""}`);
  persist(s);
  return s;
}
