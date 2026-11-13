// Front-end for the Investment Committee. Plain JavaScript, no build step.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const api = async (url, opts = {}) => {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};

// Tiny markdown renderer for dossiers and persona files (headings, bold, italics, lists, paragraphs).
function md(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/`(.+?)`/g, "<code>$1</code>");
  const out = []; let list = false;
  for (const line of String(text || "").split(/\r?\n/)) {
    const h = line.match(/^(#{1,4})\s+(.*)/); const li = line.match(/^\s*[-*]\s+(.*)/);
    if (!li && list) { out.push("</ul>"); list = false; }
    if (h) out.push(`<h4>${inline(h[2])}</h4>`);
    else if (li) { if (!list) { out.push("<ul>"); list = true; } out.push(`<li>${inline(li[1])}</li>`); }
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push("</ul>");
  return `<div class="md">${out.join("")}</div>`;
}

const ROUND_TEXT = {
  facts: ["Round 0 · Facts", "The Secretary lays out the dossier. Facts first, opinions later."],
  blind: ["Round 1 · Blind cards", "Every seat votes alone, without seeing the others."],
  roast: ["Round 2 · The roast", "Every seat attacks the card it finds most wrong."],
  rebuttal: ["Round 3 · Rebuttal", "Every seat answers its critics."],
  final: ["Round 4 · Final vote", "Final votes. Then the Head of IC decides."],
};

const state = { status: null, personas: [], byId: {}, sessions: [], session: null, viewRound: null, es: null, replay: null };

// ---------------- boot ----------------
async function boot() {
  const [status, personas] = await Promise.all([api("/api/status"), api("/api/personas")]);
  state.status = status; state.personas = personas;
  state.byId = Object.fromEntries(personas.map((p) => [p.id, p]));
  const pill = $("#modePill");
  pill.textContent = status.mode === "live" ? `Live · ${status.model}` : "No API key · demo & Claude Code mode";
  pill.className = `mode-pill ${status.mode}`;
  pill.title = status.mode === "live" ? "Seats are answered by Claude." : "New sessions from this page use placeholders. Ask Claude Code in the chat for a real session (free with your Claude plan), or add ANTHROPIC_API_KEY to .env.";

  $$("#nav button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
  $("#newSessionBtn").onclick = openNewDialog; $("#emptyNewBtn").onclick = openNewDialog;
  $("#pdfBtn").onclick = () => window.print();
  $("#sessionSelect").onchange = (e) => openSession(e.target.value);
  $("#replayBtn").onclick = replay;
  $("#askForm").onsubmit = sendAsk;
  $("#askInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendAsk(e); });
  $("#ideaForm").onsubmit = addIdea;
  $("#pfAdd").onclick = () => addPfRow({});
  $("#pfSave").onclick = savePortfolio;
  $("#reviewPortfolioBtn").onclick = async () => { await savePortfolio(); openNewDialog("portfolio"); };
  window.addEventListener("resize", debounce(() => state.session && renderTable(), 150));

  renderMembers();
  await loadSessions();
  const fromUrl = new URLSearchParams(location.search).get("s");
  const first = fromUrl || state.sessions[0]?.id;
  if (first) openSession(first); else showEmpty();
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

function showView(name) {
  $$("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  $$(".view").forEach((v) => (v.hidden = v.id !== `view-${name}`));
  if (name === "ideas") renderIdeas();
  if (name === "portfolio") loadPortfolio();
}

// ---------------- sessions ----------------
async function loadSessions() {
  state.sessions = await api("/api/sessions");
  const label = { running: "running", awaiting_decision: "awaiting decision", closed: "closed", error: "error" };
  $("#sessionSelect").innerHTML = state.sessions
    .map((s) => `<option value="${esc(s.id)}">${esc(s.title)} · ${esc(label[s.status] || s.status)}${s.decision ? " · " + esc(s.decision) : ""}</option>`)
    .join("");
  if (state.session) $("#sessionSelect").value = state.session.id;
}

function showEmpty() {
  $("#emptyState").hidden = false; $("#committeeGrid").hidden = true; $("#dossier").hidden = true;
}

function openSession(id) {
  if (state.es) state.es.close();
  stopReplay();
  state.viewRound = null;
  history.replaceState(null, "", `?s=${encodeURIComponent(id)}`);
  $("#sessionSelect").value = id;
  state.es = new EventSource(`/api/sessions/${encodeURIComponent(id)}/events`);
  let lastStatus = null;
  state.es.onmessage = (e) => {
    state.session = JSON.parse(e.data);
    if (lastStatus && lastStatus !== state.session.status) loadSessions();
    lastStatus = state.session.status;
    render();
  };
}

const roundKeys = () => state.status.rounds.map((r) => r.key);
const reachedIndex = (s) => (s.status === "running" ? roundKeys().indexOf(s.currentRound) : roundKeys().length - 1);
const shownRound = () => state.viewRound || (state.session.status === "running" ? state.session.currentRound : "final");

function render() {
  const s = state.session;
  if (!s) return;
  $("#emptyState").hidden = true; $("#committeeGrid").hidden = false; $("#dossier").hidden = false;
  const sp = $("#statusPill");
  sp.className = `status-pill ${s.status}`;
  sp.textContent = { running: `Running · ${ROUND_TEXT[s.currentRound]?.[0] || ""}`, awaiting_decision: "Awaiting your decision", closed: "Decided", error: "Error" }[s.status] || s.status;
  if (s.mode === "demo") sp.textContent += " · demo";
  if (s.mode === "claude-code") sp.textContent += " · via Claude Code";
  renderRoundTabs(); renderTable(); renderMinutes(); renderDossier();
}

function renderRoundTabs() {
  const s = state.session; const reached = reachedIndex(s); const current = shownRound();
  $("#roundTabs").innerHTML = state.status.rounds
    .map((r, i) => `<button data-r="${r.key}" class="${r.key === current ? "active" : ""} ${i < reached || s.status !== "running" ? "done" : ""}" ${i > reached ? "disabled" : ""}>${esc(r.label)}</button>`)
    .join("");
  $$("#roundTabs button").forEach((b) => (b.onclick = () => { stopReplay(); state.viewRound = b.dataset.r; render(); }));
}

// ---------- the table ----------
function seatOrder(s) {
  return { top: state.byId.secretary, bottom: state.byId.hollmann, members: s.members.map((id) => state.byId[id]).filter(Boolean) };
}

function cardFor(s, id, round) {
  if (round === "blind" || round === "roast") return s.rounds.blind[id];
  if (round === "rebuttal" || round === "final") return s.rounds.final[id] || null;
  return null;
}

function bubbleFor(s, p, round) {
  const order = roundKeys();
  const idx = order.indexOf(round);
  const thinking = s.status === "running" && s.currentRound === round;
  if (p.kind === "secretary") {
    const m = [...s.minutes].reverse().find((x) => x.speaker === "secretary" && order.indexOf(x.round) <= idx);
    if (m) return { text: m.text };
    return thinking ? { text: "Researching the dossier…", thinking: true } : null;
  }
  if (p.kind === "head") {
    if (s.decision) return { text: `My decision: ${s.decision.vote}. ${s.decision.note || ""}` };
    const m = [...s.chat].reverse().find((x) => x.speaker === "hollmann");
    return m ? { text: m.text } : null;
  }
  const id = p.id;
  if (round === "facts") return null;
  if (round === "blind") {
    const c = s.rounds.blind[id];
    if (c?.error) return { text: "Could not answer: " + c.error };
    return c ? { text: c.headline } : thinking ? { text: "Writing a blind card…", thinking: true } : null;
  }
  if (round === "roast") {
    const r = s.rounds.roast[id];
    return r ? { text: `→ ${state.byId[r.target]?.name || r.target}: ${r.critique}` } : thinking ? { text: "Sharpening the knife…", thinking: true } : null;
  }
  const f = s.rounds.final[id];
  const pending = s.status === "running" && (s.currentRound === "rebuttal" || s.currentRound === "final");
  if (round === "rebuttal") return f?.rebuttal ? { text: f.rebuttal } : pending ? { text: "Preparing a rebuttal…", thinking: true } : null;
  if (round === "final") return f && !f.error ? { text: `${f.changedMind ? "Changed my vote. " : ""}${f.headline}` } : pending ? { text: "Casting the final vote…", thinking: true } : null;
  return null;
}

function seatHtml(p, s, round) {
  const card = p.kind === "member" ? cardFor(s, p.id, round) : null;
  const b = bubbleFor(s, p, round);
  let vote = card && !card.error ? `<span class="vote ${card.vote}">${card.vote} · c${card.conviction}</span>` : "";
  if (p.kind === "head") vote = s.decision ? `<span class="vote ${s.decision.vote}">Decided ${s.decision.vote}</span>` : s.verdict ? `<span class="vote HOLD">Your call</span>` : "";
  const cls = `seat ${p.kind === "member" ? "" : p.kind} ${b?.thinking ? "thinking" : ""}`;
  return {
    seat: `<div class="${cls}" data-id="${p.id}"><div class="avatar" style="background:${esc(p.color)}">${esc(p.initials)}</div><div class="seat-name">${esc(p.name)}</div><div class="seat-title">${esc(p.title)}</div>${vote}</div>`,
    bubble: b ? `<div class="bubble ${b.thinking ? "thinking" : ""}" data-id="${p.id}"><span class="bt">${esc(b.text)}</span></div>` : "",
  };
}

function renderTable() {
  const s = state.session; const round = shownRound();
  const [title, question] = ROUND_TEXT[round];
  $("#feltRound").textContent = title;
  const sec = state.byId.secretary ? bubbleFor(s, state.byId.secretary, round) : null;
  $("#feltQuestion").textContent = sec?.text || `${question} — ${s.title}`;
  $("#feltQuestion").title = sec?.text || "";
  const t = tallyOf(round === "facts" ? {} : round === "blind" || round === "roast" ? s.rounds.blind : s.rounds.final);
  const price = s.rounds.facts?.facts?.price;
  $("#feltChips").innerHTML = round === "facts"
    ? (price != null ? `<span class="chip">Price ${esc(price)} ${esc(s.rounds.facts.facts.currency || "")}</span>` : "")
    : `<span class="chip buy">BUY ${t.BUY}</span><span class="chip hold">HOLD ${t.HOLD}</span><span class="chip sell">SELL ${t.SELL}</span>`;

  const { top, bottom, members } = seatOrder(s);
  const mobile = matchMedia("(max-width: 760px)").matches;
  const all = [top, ...members, bottom].filter(Boolean);
  let html = "";
  if (mobile) {
    html = all.map((p) => { const h = seatHtml(p, s, round); return `<div class="seat-row">${h.seat}${h.bubble || "<div></div>"}</div>`; }).join("");
  } else {
    // Members sit on the left and right of the table; the Secretary at the head, the Head of IC at the foot.
    const right = Math.ceil(members.length / 2); const left = members.length - right;
    const spread = (n, k) => (n === 1 ? 0 : -56 + (k * 112) / (n - 1));
    const place = [{ p: top, a: -90 }, { p: bottom, a: 90 }];
    members.forEach((p, i) => place.push({ p, a: i < right ? spread(right, i) : 180 - spread(left, i - right) }));
    for (const { p, a } of place) {
      if (!p) continue;
      const rad = (a * Math.PI) / 180; const cos = Math.cos(rad); const sin = Math.sin(rad);
      const x = 50 + 43 * cos; const y = 50 + 41 * sin;
      const h = seatHtml(p, s, round);
      html += h.seat.replace('class="seat', `style="left:${x}%;top:${y}%" class="seat`);
      if (p.kind !== "member" || !h.bubble) continue; // Secretary speaks in the middle of the table
      const by = sin > 0.7 ? y - 10 : y - 5; // lift bubbles of the bottom seats so the Head of IC stays visible
      const bpos = cos >= 0 ? `right:${100 - x + 5.5}%;top:${by}%` : `left:${x + 5.5}%;top:${by}%`;
      html += h.bubble.replace('class="bubble', `style="${bpos}" class="bubble`);
    }
  }
  $("#seats").innerHTML = html;
  $$("#seats .seat, #seats .bubble").forEach((el) => (el.onclick = () => openSeat(el.dataset.id)));
}

function tallyOf(cards) {
  const v = { BUY: 0, HOLD: 0, SELL: 0 };
  Object.values(cards || {}).forEach((c) => c && !c.error && v[c.vote]++);
  return v;
}

function openSeat(id) {
  const s = state.session; const p = state.byId[id];
  if (!p) return;
  let body = `<div class="member-card"><div class="head"><div class="avatar" style="background:${esc(p.color)}">${esc(p.initials)}</div><div><h2>${esc(p.name)}</h2><div class="muted">${esc(p.title)} · ${esc(p.lens)}</div></div></div>`;
  if (p.kind === "member") {
    const blind = s.rounds.blind[id]; const fin = s.rounds.final[id]; const roast = s.rounds.roast[id];
    const against = s.members.filter((o) => s.rounds.roast[o]?.target === id);
    body += cardBlock("Round 1 · Blind card", blind);
    if (roast) body += `<h4>Round 2 · Attacked ${esc(state.byId[roast.target]?.name)}</h4><p>${esc(roast.critique)}</p>`;
    if (against.length) body += `<h4>Attacks received</h4><ul>${against.map((o) => `<li><b>${esc(state.byId[o]?.name)}:</b> ${esc(s.rounds.roast[o].critique)}</li>`).join("")}</ul>`;
    if (fin?.rebuttal) body += `<h4>Round 3 · Rebuttal</h4><p>${esc(fin.rebuttal)}</p>`;
    body += cardBlock("Round 4 · Final vote", fin);
  } else {
    body += md(p.prompt);
  }
  $("#seatDetail").innerHTML = body + "</div>";
  $("#seatDialog").showModal();
}

function cardBlock(title, c) {
  if (!c) return `<h4>${title}</h4><p class="muted">Not yet.</p>`;
  if (c.error) return `<h4>${title}</h4><p class="muted">Error: ${esc(c.error)}</p>`;
  const fv = c.fairValue || {};
  return `<h4>${title}: <span class="vote ${c.vote}">${c.vote} · conviction ${c.conviction}</span></h4>
    <p><b>${esc(c.headline)}</b></p><p>${esc(c.thesis)}</p>
    <dl class="kv"><dt>Fair value bear / base / bull</dt><dd>${esc(fv.bear ?? "–")} / ${esc(fv.base ?? "–")} / ${esc(fv.bull ?? "–")}</dd>
    <dt>Would change my mind</dt><dd>${esc(c.changeMyMind)}</dd></dl>
    ${c.keyRisks?.length ? `<p><b>Risks:</b></p><ul>${c.keyRisks.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
    ${c.missingFacts?.length ? `<p><b>Missing facts:</b></p><ul>${c.missingFacts.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
    ${c.positions?.length ? `<p><b>Positions:</b></p><ul>${c.positions.map((x) => `<li><b>${esc(x.ticker)}</b> ${esc(x.action)} — ${esc(x.comment)}</li>`).join("")}</ul>` : ""}`;
}

// ---------- minutes & chat ----------
function renderMinutes() {
  const s = state.session; const list = $("#minutesList");
  const key = `${s.id}:${s.minutes.length}`;
  const grew = list.dataset.key !== key; // new session or new entries -> jump to the latest entry
  list.dataset.key = key;
  list.innerHTML = s.minutes.map((m) => {
    const p = state.byId[m.speaker] || { name: m.speaker, initials: "?", color: "#777", kind: "member" };
    const cls = p.kind === "secretary" ? "secretary" : p.kind === "head" ? "head" : "";
    return `<div class="minute ${cls}"><div class="mini-av" style="background:${esc(p.color)}">${esc(p.initials)}</div><div><div class="who">${esc(p.name)}<small>${esc(ROUND_TEXT[m.round]?.[0] || "")}</small></div><div class="what">${esc(m.text)}</div></div></div>`;
  }).join("") + (s.errors?.length ? `<div class="minute"><div></div><div class="what muted">Errors: ${esc(s.errors.join(" | "))}</div></div>` : "");
  if (grew) { list.scrollTop = list.scrollHeight; requestAnimationFrame(() => (list.scrollTop = list.scrollHeight)); }
  $("#mentionChips").innerHTML = ["all", ...s.members].map((id) => {
    const tag = id === "all" ? "all" : state.byId[id]?.name.split(" ").at(-1);
    return `<button type="button" data-tag="${esc(tag)}">@${esc(tag)}</button>`;
  }).join("");
  $$("#mentionChips button").forEach((b) => (b.onclick = () => { const i = $("#askInput"); i.value = `@${b.dataset.tag} ` + i.value.replace(/^@\S+\s*/, ""); i.focus(); }));
}

async function sendAsk(e) {
  e.preventDefault();
  const input = $("#askInput"); const text = input.value.trim();
  if (!text || !state.session) return;
  input.value = ""; input.disabled = true;
  try { await api(`/api/sessions/${state.session.id}/ask`, { method: "POST", body: { text } }); }
  catch (err) { alert(err.message); }
  finally { input.disabled = false; input.focus(); }
}

// ---------- dossier ----------
function median(arr) { const a = arr.filter((v) => typeof v === "number").sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; }

function renderDossier() {
  const s = state.session; const f = s.rounds.facts; const facts = f?.facts || {};
  $("#factsCol").innerHTML = !f ? `<p class="muted">The Secretary is preparing the dossier…</p>` : `
    <h3>${esc(facts.company || s.idea.name)}</h3>
    <div class="muted small">${esc(facts.ticker || s.idea.ticker)} · ${esc(facts.currency || "")} · idea from ${esc(s.idea.source || "n/a")}</div>
    <dl class="kv" style="margin-top:8px">
      ${facts.price != null ? `<dt>Price</dt><dd>${esc(facts.price)} ${esc(facts.currency || "")} <span class="muted small">${esc(facts.priceDate || "")}</span></dd>` : ""}
      ${(facts.keyFacts || []).map((k) => `<dt>${esc(k.label)}</dt><dd>${esc(k.value)}</dd>`).join("")}
    </dl>
    ${md(f.text)}
    ${f.sources?.length ? `<h4>Sources</h4><ul>${f.sources.slice(0, 12).map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || x.url)}</a></li>`).join("")}</ul>` : ""}`;

  const v = s.verdict;
  const rows = s.members.map((id) => {
    const b = s.rounds.blind[id]; const fi = s.rounds.final[id];
    return `<tr><td>${esc(state.byId[id]?.name)}</td><td>${b && !b.error ? `<span class="vote ${b.vote}">${b.vote}</span>` : "–"}</td><td>${fi && !fi.error ? `<span class="vote ${fi.vote}">${fi.vote}</span> c${fi.conviction}` : "–"}</td><td>${esc(fi?.fairValue?.base ?? b?.fairValue?.base ?? "–")}</td></tr>`;
  }).join("");
  let positions = "";
  if (s.type === "portfolio") {
    const tickers = [...new Set(s.members.flatMap((id) => (s.rounds.final[id]?.positions || s.rounds.blind[id]?.positions || []).map((p) => p.ticker)))];
    if (tickers.length) {
      positions = `<h4>Holdings × seats (final)</h4><div class="table-scroll"><table class="seat-table"><tr><th>Holding</th>${s.members.map((id) => `<th title="${esc(state.byId[id]?.name)}">${esc(state.byId[id]?.initials)}</th>`).join("")}</tr>
      ${tickers.map((t) => `<tr><td><b>${esc(t)}</b></td>${s.members.map((id) => { const x = (s.rounds.final[id]?.positions || s.rounds.blind[id]?.positions || []).find((p) => p.ticker === t); return `<td class="act-${esc(x?.action || "")}" title="${esc(x?.comment || "")}">${esc(x?.action || "–")}</td>`; }).join("")}</tr>`).join("")}</table></div>`;
    }
  }
  $("#verdictCol").innerHTML = `
    <h3>Verdict${v ? "" : " — pending"}</h3>
    ${v ? `<p><b>${esc(v.consensus)}</b>${v.herdAlarm ? ' · <span class="vote SELL">herd alarm</span>' : ""}</p><p>${esc(v.summary)}</p>
      ${list("Where the seats agree", v.agreements)}${list("Where they disagree", v.disagreements)}${list("Key risks", v.keyRisks)}${list("Open questions", v.openQuestions)}
      ${v.positionSizing ? `<h4>Sizing</h4><p>${esc(v.positionSizing)}</p>` : ""}` : `<p class="muted">Appears after the final vote.</p>`}
    <h4>Votes per seat</h4>
    <table class="seat-table"><tr><th>Seat</th><th>Blind</th><th>Final</th><th>Base FV</th></tr>${rows}</table>${positions}`;

  renderDecision();
}

function list(title, items) { return items?.length ? `<h4>${esc(title)}</h4><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""; }

function renderDecision() {
  const s = state.session; const v = s.verdict; const col = $("#decisionCol");
  const finals = Object.values(s.rounds.final).filter((c) => c && !c.error);
  const blinds = Object.values(s.rounds.blind).filter((c) => c && !c.error);
  const cards = finals.length ? finals : blinds;
  const fv = { bear: median(cards.map((c) => c.fairValue?.bear)), base: median(cards.map((c) => c.fairValue?.base)), bull: median(cards.map((c) => c.fairValue?.bull)) };
  const price = s.rounds.facts?.facts?.price;
  const maxV = Math.max(...[fv.bear, fv.base, fv.bull, price].filter((x) => typeof x === "number"), 1);
  const bar = (label, val, color) => typeof val === "number" ? `<span>${label}</span><div class="bar-track"><div class="bar-fill" style="width:${(val / maxV) * 100}%;background:${color}"></div></div><span style="text-align:right">${val}</span>` : "";
  const split = (t, n) => n ? `<div class="vote-split">${["BUY", "HOLD", "SELL"].map((k) => `<span style="flex:${t[k]};background:var(--${k.toLowerCase()})" title="${k} ${t[k]}"></span>`).join("")}</div>` : "";
  const tb = tallyOf(s.rounds.blind); const tf = tallyOf(s.rounds.final);

  let decisionHtml;
  if (s.decision) {
    decisionHtml = `<div class="big"><span class="vote ${s.decision.vote}" style="font-size:1.2rem">${s.decision.vote}</span></div><p>${esc(s.decision.note)}</p><p class="muted small">Decided ${esc(s.decision.at.slice(0, 16).replace("T", " "))}</p>`;
  } else if (v) {
    decisionHtml = `<p class="muted small">The committee recommends <b>${esc(v.recommendation)}</b>. Your call:</p>
      <div class="decision-buttons">${["BUY", "HOLD", "SELL"].map((k) => `<button class="btn" data-vote="${k}">${k}</button>`).join("")}</div>
      <textarea id="decisionNote" rows="2" placeholder="Reason / size / next review date"></textarea>
      <button class="btn primary" id="decideBtn" disabled style="margin-top:6px">Record decision</button>`;
  } else {
    decisionHtml = `<p class="muted">You decide once the committee has voted.</p>`;
  }
  col.innerHTML = `<div class="muted small">Decision of the Head of IC</div>${decisionHtml}
    ${v ? `<p class="small">Committee: <b>${esc(v.recommendation)}</b> — ${esc(v.consensus)}</p>` : ""}
    <h4>Votes</h4>
    ${blinds.length ? `<div class="small muted">Blind ${tb.BUY}-${tb.HOLD}-${tb.SELL}</div>${split(tb, blinds.length)}` : ""}
    ${finals.length ? `<div class="small muted">Final ${tf.BUY}-${tf.HOLD}-${tf.SELL}</div>${split(tf, finals.length)}` : ""}
    ${fv.base != null ? `<h4>Fair value (median of seats)</h4><div class="bars">${bar("bear", fv.bear, "var(--sell)")}${bar("base", fv.base, "#2f6db5")}${bar("bull", fv.bull, "var(--buy)")}${bar("price", price, "var(--text)")}</div>` : ""}`;

  let chosen = null;
  $$(".decision-buttons .btn", col).forEach((b) => (b.onclick = () => {
    chosen = b.dataset.vote;
    $$(".decision-buttons .btn", col).forEach((x) => (x.className = "btn" + (x === b ? ` sel-${chosen}` : "")));
    $("#decideBtn").disabled = false;
  }));
  const d = $("#decideBtn");
  if (d) d.onclick = async () => {
    await api(`/api/sessions/${s.id}/decision`, { method: "POST", body: { vote: chosen, note: $("#decisionNote").value } });
    loadSessions();
  };
}

// ---------- replay ----------
function replay() {
  stopReplay();
  const keys = roundKeys().slice(0, reachedIndex(state.session) + 1);
  let i = 0;
  state.viewRound = keys[0]; render();
  $("#replayBtn").textContent = "■ Stop";
  $("#replayBtn").onclick = () => { stopReplay(); render(); };
  state.replay = setInterval(() => {
    i++;
    if (i >= keys.length) { stopReplay(); return; }
    state.viewRound = keys[i]; render();
  }, 3500);
}
function stopReplay() {
  clearInterval(state.replay); state.replay = null;
  const b = $("#replayBtn"); b.textContent = "▶ Replay"; b.onclick = replay;
}

// ---------- new session dialog ----------
async function openNewDialog(type) {
  const ideas = await api("/api/ideas");
  $("#ideaSelect").innerHTML = ideas.map((i) => `<option value="${esc(i.id)}">${esc(i.proposedAction)} ${esc(i.ticker)} — ${esc(i.name)} (${esc(i.source)})</option>`).join("");
  $("#memberChecks").innerHTML = state.personas.filter((p) => p.kind === "member")
    .map((p) => `<label><input type="checkbox" name="m" value="${esc(p.id)}" checked /> ${esc(p.name)}</label>`).join("");
  const form = $("#newForm");
  if (typeof type === "string") form.type.value = type;
  const sync = () => {
    $("#ideaPick").hidden = form.type.value !== "idea";
    const n = $$('input[name="m"]:checked', form).length;
    $("#costHint").textContent = state.status.mode === "live"
      ? `About ${3 * n + 2} AI calls (${n} seats × 3 + dossier + verdict). Takes a few minutes and costs a few dollars with ${state.status.model}.`
      : "Demo mode: placeholder answers, no costs.";
  };
  form.onchange = sync; sync();
  $("#newDialog").showModal();
  $("#newDialog").onclose = async () => {
    if ($("#newDialog").returnValue !== "start") return;
    const memberIds = $$('input[name="m"]:checked', form).map((i) => i.value);
    const body = form.type.value === "portfolio" ? { type: "portfolio", memberIds } : { type: "idea", ideaId: form.ideaId.value, memberIds };
    try {
      const s = await api("/api/sessions", { method: "POST", body });
      showView("committee");
      await loadSessions();
      openSession(s.id);
    } catch (err) { alert(err.message); }
  };
}

// ---------------- ideas ----------------
async function renderIdeas() {
  const ideas = await api("/api/ideas");
  const groups = {};
  ideas.forEach((i) => (groups[i.source] ||= []).push(i));
  $("#ideasList").innerHTML = Object.entries(groups).map(([src, items]) => `<div class="idea-group"><h3>${esc(src)}</h3>${items.map((i) => `
    <div class="idea"><div><div class="tick">${esc(i.ticker || "—")}</div><span class="vote ${esc(i.proposedAction)}">${esc(i.proposedAction)}</span></div>
      <div><b>${esc(i.name)}</b><div>${esc(i.thesis)}</div><div class="meta">${esc(i.sourceDate || "")} · added ${esc(i.addedAt || "")}</div></div>
      <div class="actions"><button class="btn small primary" data-discuss="${esc(i.id)}">Discuss</button><button class="btn small ghost" data-del="${esc(i.id)}" title="Remove">✕</button></div></div>`).join("")}</div>`).join("");
  $$("[data-discuss]").forEach((b) => (b.onclick = async () => { await openNewDialog("idea"); $("#ideaSelect").value = b.dataset.discuss; }));
  $$("[data-del]").forEach((b) => (b.onclick = async () => { if (confirm("Remove this idea?")) { await api(`/api/ideas/${b.dataset.del}`, { method: "DELETE" }); renderIdeas(); } }));
}

async function addIdea(e) {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  await api("/api/ideas", { method: "POST", body });
  e.target.reset(); e.target.source.value = "Own idea";
  renderIdeas();
}

// ---------------- portfolio ----------------
async function loadPortfolio() {
  const pf = await api("/api/portfolio");
  $("#pfCurrency").value = pf.baseCurrency || "EUR";
  $("#pfCash").value = pf.cash ?? 0;
  $("#pfRows").innerHTML = "";
  pf.positions.forEach(addPfRow);
}
function addPfRow(p) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td><input data-k="ticker" value="${esc(p.ticker || "")}" /></td><td><input data-k="name" value="${esc(p.name || "")}" /></td>
    <td><input data-k="shares" type="number" step="any" value="${esc(p.shares ?? "")}" /></td><td><input data-k="avgCost" type="number" step="any" value="${esc(p.avgCost ?? "")}" /></td>
    <td><input data-k="currency" value="${esc(p.currency || "EUR")}" /></td><td><button class="btn small ghost" title="Remove">✕</button></td>`;
  tr.querySelector("button").onclick = () => tr.remove();
  $("#pfRows").appendChild(tr);
}
async function savePortfolio() {
  const positions = $$("#pfRows tr").map((tr) => {
    const o = {}; $$("input", tr).forEach((i) => (o[i.dataset.k] = i.type === "number" ? Number(i.value) : i.value.trim())); return o;
  }).filter((p) => p.ticker);
  await api("/api/portfolio", { method: "PUT", body: { baseCurrency: $("#pfCurrency").value, cash: Number($("#pfCash").value), positions } });
  $("#pfSaved").textContent = "Saved ✓"; setTimeout(() => ($("#pfSaved").textContent = ""), 2000);
}

// ---------------- members ----------------
function renderMembers() {
  $("#membersGrid").innerHTML = state.personas.map((p) => `
    <div class="card member-card"><div class="head"><div class="avatar" style="background:${esc(p.color)}">${esc(p.initials)}</div>
      <div><h3>${esc(p.name)}</h3><div class="muted small">${esc(p.title)} · ${esc({ head: "Head of IC (you)", secretary: "Neutral chair", member: "Committee seat" }[p.kind])}</div></div></div>
      <p>${esc(p.lens)}</p>${p.inspiredBy ? `<p class="muted small">Inspired by: ${esc(p.inspiredBy)}</p>` : ""}
      <p class="muted small">File: <code>personas/${esc(p.file)}</code></p>
      <details><summary>Show full profile</summary>${md(p.prompt)}</details></div>`).join("");
}

boot();
