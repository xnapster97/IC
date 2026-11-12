// DEMO mode: used when no ANTHROPIC_API_KEY is set.
// Produces deterministic placeholder answers so you can click through the app for free.
// Nothing here is analysis — every text is marked [Demo].

const hash = (str) => [...str].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const pick = (arr, seed) => arr[seed % arr.length];
const DEMO_PRICE = 100;

const LINES = {
  buffett: ["I'd want to know this business will be stronger in ten years.", "Price matters, but a wonderful business forgives a lot.", "If I can't explain the moat to a ten-year-old, I'll pass."],
  munger: ["Invert: how does this go to zero? I don't see it — or I do.", "Show me the incentives and I'll show you the outcome.", "Too hard. Next."],
  ackman: ["Simple, predictable, free-cash-flow generative — and there's a catalyst.", "If we like it, we should own enough for it to matter.", "The market is pricing a temporary problem as permanent."],
  griffin: ["What's the catalyst in the next two quarters, and how crowded is it?", "Size it by volatility, not by enthusiasm.", "I want the stress test before the story."],
  lynch: ["Which of the six categories is it? That decides the rules.", "PEG looks reasonable — let the winner run.", "Give me the two-minute story first."],
  wood: ["The cost curve is collapsing; the five-year TAM is much larger than consensus.", "Volatility is the price of admission for innovation.", "Incumbents get disrupted faster than models assume."],
  burry: ["Read footnote 14. The capitalised costs flatter earnings.", "Everyone owns it. That's the risk.", "Tangible downside protection is thin at this price."],
  dalio: ["Which regime does this need? Falling rates and stable growth.", "It adds no new return stream to the portfolio.", "The way I see it, the debt cycle matters more than the quarter."],
  marks: ["It's a good company — but is it better than the price implies?", "The pendulum has swung towards optimism.", "We can't predict, but we can prepare."],
  quant: ["Momentum positive, revisions neutral, valuation rich: composite neutral.", "Base rate for this growth/valuation profile is mediocre.", "Factor exposure is mostly market beta."],
};

function vote(p, s, salt) {
  const [b, h, sl] = p.demoWeights;
  const r = hash(`${p.id}|${s.idea.ticker}|${s.idea.name}|${salt}`) % (b + h + sl);
  return r < b ? "BUY" : r < b + h ? "HOLD" : "SELL";
}

export function facts(s) {
  return {
    text: `**[Demo] No API key set — this is a placeholder dossier.**\n\nTopic: ${s.title}\n\nSource of the idea: ${s.idea.source || "n/a"}\n\n${s.idea.thesis}\n\nIn live mode the Secretary researches the current price, valuation, balance sheet, news and the bull/bear debate here.`,
    facts: {
      company: s.idea.name,
      ticker: s.idea.ticker,
      currency: "USD",
      price: DEMO_PRICE,
      priceDate: "demo",
      keyFacts: [{ label: "Mode", value: "Demo placeholder" }, { label: "Source", value: s.idea.source || "n/a" }],
    },
    sources: [],
  };
}

export function card(p, s, salt) {
  const v = vote(p, s, salt);
  const seed = hash(p.id + s.idea.ticker + salt);
  const tilt = v === "BUY" ? 1.2 : v === "SELL" ? 0.8 : 1.0;
  const positions = s.type === "portfolio"
    ? (s.idea.thesis.match(/^- ([^\s(]+)/gm) || []).map((l, i) => ({
        ticker: l.slice(2),
        action: pick(["ADD", "HOLD", "HOLD", "TRIM", "SELL"], hash(p.id + l) + i),
        comment: "[Demo] placeholder",
      }))
    : [];
  return {
    vote: v,
    conviction: (seed % 4) + 2,
    headline: `[Demo] ${pick(LINES[p.id] || ["Placeholder view."], seed)}`,
    thesis: `[Demo] ${p.name} looks at this through the lens "${p.lens}". In live mode this is a real argument based on the dossier.`,
    keyRisks: ["[Demo] valuation", "[Demo] execution"],
    changeMyMind: "[Demo] a better price or new facts",
    fairValue: { bear: Math.round(DEMO_PRICE * tilt * 0.7), base: Math.round(DEMO_PRICE * tilt), bull: Math.round(DEMO_PRICE * tilt * 1.35) },
    missingFacts: [],
    positions,
  };
}

export function roast(p, targets, s) {
  const target = pick(targets, hash(p.id + s.idea.ticker));
  return { target, critique: `[Demo] ${pick(LINES[p.id] || ["I disagree."], hash(target))}` };
}

export function final(p, s, against) {
  const c = card(p, s, against.length ? "final" : "blind");
  const blind = s.rounds.blind[p.id];
  return { ...c, rebuttal: `[Demo] ${against.length ? "Fair point, but my view stands on the core thesis." : "Nobody came for me; I'll keep my card."}`, changedMind: blind ? blind.vote !== c.vote : false };
}

export function verdict(s, t) {
  const entries = Object.entries(t.votes).sort((a, b) => b[1] - a[1]);
  const tie = entries[0][1] === entries[1][1];
  const rec = tie ? "HOLD" : entries[0][0];
  return {
    recommendation: rec,
    consensus: `${tie ? "Split committee" : "Majority " + rec} (${t.votes.BUY}-${t.votes.HOLD}-${t.votes.SELL})`,
    summary: "[Demo] Placeholder verdict. Add your Anthropic API key to get a real debate.",
    agreements: ["[Demo] agreement"],
    disagreements: ["[Demo] disagreement"],
    keyRisks: ["[Demo] risk"],
    openQuestions: ["[Demo] question"],
    positionSizing: "[Demo] n/a",
    herdAlarm: t.unanimous,
  };
}

export function chatReply(p, text) {
  return `[Demo] ${p.name} heard: "${text.slice(0, 80)}". ${pick(LINES[p.id] || ["Noted — the decision is yours, Head of IC."], hash(text))}`;
}
