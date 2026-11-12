// Tiny JSON-file storage. Everything lives in /data so you can open and edit it by hand.
import fs from "node:fs";
import path from "node:path";

const DATA = path.resolve("data");
const SESSIONS = path.join(DATA, "sessions");
fs.mkdirSync(SESSIONS, { recursive: true });

const readJson = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; }
};
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));

export const ideas = {
  list: () => readJson(path.join(DATA, "ideas.json"), []),
  save: (list) => writeJson(path.join(DATA, "ideas.json"), list),
};

export const portfolio = {
  get: () => readJson(path.join(DATA, "portfolio.json"), { baseCurrency: "EUR", cash: 0, positions: [] }),
  save: (p) => writeJson(path.join(DATA, "portfolio.json"), p),
};

export const sessions = {
  list: () =>
    fs.readdirSync(SESSIONS)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson(path.join(SESSIONS, f), null))
      .filter(Boolean)
      .map(({ id, title, createdAt, status, type, verdict, decision }) => ({
        id, title, createdAt, status, type,
        recommendation: verdict?.recommendation || null,
        decision: decision?.vote || null,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  get: (id) => readJson(path.join(SESSIONS, `${path.basename(id)}.json`), null),
  save: (s) => writeJson(path.join(SESSIONS, `${s.id}.json`), s),
};
