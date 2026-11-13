# Investment Committee — notes for Claude Code

The owner (Xandi Hollmann, Head of IC) is a beginner, writes in German, and works from an iPad in Claude Code on the web.
Talk to them in German, step by step. The app itself (UI, personas, session content) is in English.

## Claude Code mode (no API key — the default for now)

The owner does not pay for an API key yet. Committee sessions are written **by you in the chat** and imported:

1. **Research** with web search: current price and date, latest results and guidance, valuation, recent news, bull and bear case. Note conflicting sources and mark estimates as estimates.
2. **Read every persona** in `personas/` (including the Head of IC mandate in `00-xandi-hollmann.md`) and write each seat strictly in character.
3. **Write the session JSON** to `data/claude-code/<date>-<ticker>.json`. Use `data/claude-code/2026-11-13-nvda.json` as the template:
   - `facts` (markdown dossier + `facts` key figures + `sources`)
   - `blind` — one card per seat, written independently
   - `roast` — each seat attacks ONE other seat (`target` = seat id)
   - `final` — `rebuttal` + final card per seat; lower conviction or change vote only if the debate really warrants it
   - `verdict` — recommendation follows the final majority; on a tie choose the more cautious option and say so
   - Fair values per share in the stock's currency; `null` if a seat (e.g. The Quant) would not estimate one
   - Portfolio reviews: `"type": "portfolio"`, and each card has `positions: [{ticker, action: ADD|HOLD|TRIM|SELL, comment}]`
4. **Import:** `node scripts/committee.js import data/claude-code/<file>.json`
5. Start the app if it isn't running (`npm start`, port 4730) and report the preview port.
6. Commit and push to the working branch so the session survives the cloud container.

**Questions in the minutes:** the owner can ask `@Buffett …` in the app. Without an API key the question waits.
When asked to "answer the open questions": run `node scripts/committee.js open`, write the replies in character,
save them as `{ "sessionId": "...", "replies": [{ "speaker": "<seat id>", "text": "..." }] }` and run
`node scripts/committee.js reply <file>`.

## Rules for the seats

- Seats are simulations built from public material: no invented quotes, no claims about the real person's current private trades.
- Use only numbers from the research; list missing numbers instead of inventing them.
- Always consider the owner's existing portfolio (`data/portfolio.json`) for sizing and concentration.
- Decision support, not financial advice. The Head of IC decides.

## Code map

`server.js` (API + SSE, watches `data/sessions/`), `src/committee.js` (live API rounds), `src/importer.js` (Claude Code mode),
`src/llm.js` (Claude API), `src/demo.js` (placeholders), `public/` (UI, no build step), `personas/` (one file per seat).
