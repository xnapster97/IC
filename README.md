# Investment Committee

A simulated investment committee for your own investment decisions. AI seats modelled on the **public** philosophies of well-known investors debate stock ideas and your portfolio. As **Head of IC**, you make the final call.

> Simulation only. The seats are built from public material; their words are not quotes from the real people. Not investment advice; no orders are placed.

## Schnellstart (Deutsch)

1. **Node.js installieren** (Version 22 oder neuer): https://nodejs.org
2. **Projekt holen** und im Projektordner ein Terminal öffnen:
   ```bash
   npm install
   ```
3. **API-Schlüssel eintragen** (optional — ohne Schlüssel läuft ein kostenloser Demo-Modus mit Platzhaltern):
   - Schlüssel erstellen auf https://console.anthropic.com
   - Datei `.env.example` kopieren und in `.env` umbenennen, Schlüssel hinter `ANTHROPIC_API_KEY=` einfügen
4. **Starten:**
   ```bash
   npm start
   ```
5. Im Browser öffnen: **http://localhost:4730**

## Free: Claude Code mode (no API key)

Without an API key you can still run real committee sessions: ask Claude Code in the chat, e.g.
*„Starte eine Komitee-Sitzung zu Nvidia“*. Claude researches the facts, writes every seat's cards, roasts and final votes,
and imports the session (`node scripts/committee.js import data/claude-code/<file>.json`). It appears in the app like any other session.
Questions you type in the minutes wait until you tell Claude Code: *„Beantworte die offenen Fragen im Komitee.“*
Details for Claude are in `CLAUDE.md`.

## How a session works

| Round | What happens |
|---|---|
| 0 · Facts | The Committee Secretary researches the idea on the web and writes the dossier (price, valuation, news, bull vs. bear). |
| 1 · Blind cards | Every seat votes BUY / HOLD / SELL with conviction (1–5), a thesis, risks and a bear/base/bull fair value — without seeing the others. |
| 2 · Roast | Every seat attacks the card it finds most wrong. If the vote was unanimous, the Secretary raises a herd alarm. |
| 3 · Rebuttal | Every seat answers its critics. |
| 4 · Final vote | Final votes; the Secretary writes the verdict. Then **you** record the decision. |

During or after a session, write in the **Minutes** box: `@Buffett …` asks one seat, `@all …` asks everyone, no `@` asks the Secretary. Your notes are passed to the seats as context.

**Portfolio review:** enter your holdings on the *Portfolio* page and press *Review in committee*. Each seat gives every holding ADD / HOLD / TRIM / SELL.

## The seats

| File | Seat |
|---|---|
| `personas/00-xandi-hollmann.md` | Xandi Hollmann — Head of IC (you, human seat; your mandate is shared with every seat) |
| `personas/01-secretary.md` | Committee Secretary — neutral chair, dossier and minutes |
| `personas/10-warren-buffett.md` | Warren Buffett — quality at a fair price, moats, owner earnings |
| `personas/11-charlie-munger.md` | Charlie Munger — inversion, mental models, incentives |
| `personas/12-bill-ackman.md` | Bill Ackman — concentrated quality, catalysts, activism |
| `personas/13-ken-griffin.md` | Ken Griffin — risk-first multi-strategy, sizing, stress tests |
| `personas/20-peter-lynch.md` | Peter Lynch — growth at a reasonable price, six stock categories |
| `personas/21-cathie-wood.md` | Cathie Wood — disruptive innovation, 5-year horizon |
| `personas/22-michael-burry.md` | Michael Burry — contrarian deep value, accounting scepticism |
| `personas/23-ray-dalio.md` | Ray Dalio — macro, debt cycles, diversification |
| `personas/24-howard-marks.md` | Howard Marks — cycles, second-level thinking, risk control |
| `personas/30-the-quant.md` | The Quant — systematic factors (archetype) |

**Add a seat:** copy a persona file, change the `id`, `name`, `initials`, `color` and the text. Restart the server — the new seat appears at the table.

## Ideas

`data/ideas.json` holds the idea pipeline (bank conviction lists, 13F holdings, your own ideas). Add ideas on the *Idea pipeline* page or edit the file. Entries taken from press reports should be verified before acting.

## Settings (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | Your key. Without it: demo mode. |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model for all seats. |
| `CLAUDE_EFFORT` | `medium` | `low` / `medium` / `high` — depth of thinking vs. cost and speed. |
| `IC_WEB_RESEARCH` | `1` | `0` turns off web research in the fact round. |
| `PORT` | `4730` | Web server port. |

A session with 10 seats makes about 32 AI calls and takes a few minutes.

## Project layout

```
server.js          web server + API
src/committee.js   the five rounds, prompts and JSON schemas
src/llm.js         the Claude API call (structured output, web search, fallback)
src/demo.js        placeholder answers for demo mode
src/personas.js    loads personas/*.md
src/store.js       JSON storage in data/
public/            the web page (HTML, CSS, JS — no build step)
personas/          one file per seat
data/              ideas, portfolio, saved sessions
```
