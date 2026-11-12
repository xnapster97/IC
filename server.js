// Web server: serves the UI from /public and a small JSON API under /api.
import express from "express";
import { loadPersonas } from "./src/personas.js";
import { ideas, portfolio, sessions } from "./src/store.js";
import { createSession, askCommittee, decide, events, ROUNDS } from "./src/committee.js";
import { isLive, MODEL, WEB_RESEARCH } from "./src/llm.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

app.get("/api/status", (_req, res) =>
  res.json({ mode: isLive() ? "live" : "demo", model: MODEL, webResearch: WEB_RESEARCH, rounds: ROUNDS })
);

app.get("/api/personas", (_req, res) => res.json(loadPersonas()));

// ----- ideas -----
app.get("/api/ideas", (_req, res) => res.json(ideas.list()));
app.post("/api/ideas", (req, res) => {
  const { ticker = "", name, source = "Own idea", thesis = "", proposedAction = "BUY" } = req.body || {};
  if (!name && !ticker) return res.status(400).json({ error: "Name or ticker required" });
  const idea = {
    id: `${(ticker || name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`,
    ticker: ticker.toUpperCase(), name: name || ticker, source, sourceDate: new Date().toISOString().slice(0, 7),
    thesis, proposedAction, addedAt: new Date().toISOString().slice(0, 10),
  };
  ideas.save([idea, ...ideas.list()]);
  res.json(idea);
});
app.delete("/api/ideas/:id", (req, res) => {
  ideas.save(ideas.list().filter((i) => i.id !== req.params.id));
  res.json({ ok: true });
});

// ----- portfolio -----
app.get("/api/portfolio", (_req, res) => res.json(portfolio.get()));
app.put("/api/portfolio", (req, res) => {
  const p = req.body;
  if (!p || !Array.isArray(p.positions)) return res.status(400).json({ error: "positions[] required" });
  portfolio.save(p);
  res.json(p);
});

// ----- sessions -----
app.get("/api/sessions", (_req, res) => res.json(sessions.list()));
app.get("/api/sessions/:id", (req, res) => {
  const s = sessions.get(req.params.id);
  s ? res.json(s) : res.status(404).json({ error: "Not found" });
});
app.post("/api/sessions", (req, res) => {
  const { type = "idea", ideaId, idea, memberIds } = req.body || {};
  let chosen = idea;
  if (type === "idea" && !chosen) chosen = ideas.list().find((i) => i.id === ideaId);
  if (type === "idea" && !chosen) return res.status(400).json({ error: "Pick an idea" });
  res.json(createSession({ type, idea: chosen, memberIds }));
});
app.post("/api/sessions/:id/ask", async (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Empty message" });
  res.json(await askCommittee(s, text));
});
app.post("/api/sessions/:id/decision", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "Not found" });
  if (!["BUY", "HOLD", "SELL"].includes(req.body?.vote)) return res.status(400).json({ error: "vote must be BUY, HOLD or SELL" });
  res.json(decide(s, req.body));
});

// Live updates while a session runs (Server-Sent Events)
app.get("/api/sessions/:id/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const send = (s) => res.write(`data: ${JSON.stringify(s)}\n\n`);
  const current = sessions.get(req.params.id);
  if (current) send(current);
  events.on(req.params.id, send);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(ping);
    events.off(req.params.id, send);
  });
});

app.get("/api/tally", (_req, res) => res.json(tally({})));

const PORT = Number(process.env.PORT || 4730);
app.listen(PORT, () => {
  console.log(`\nInvestment Committee running at http://localhost:${PORT}`);
  console.log(isLive() ? `Mode: LIVE (model ${MODEL})` : "Mode: DEMO (no ANTHROPIC_API_KEY found — answers are placeholders)");
});
