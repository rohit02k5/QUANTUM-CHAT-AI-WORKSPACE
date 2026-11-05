# Media Shot List

Capture on the demo deployment (`DEMO_MODE=true`) in dark **and** light mode where the theme matters. Save to `docs/media/`.

## Screenshots (in priority order)

| # | State | Shot |
|---|-------|------|
| 1 | `/welcome` | Landing hero + Quality numbers section (full page) |
| 2 | Login page | "Try the demo" button visible |
| 3 | Chat | Cited answer with timestamp chips + "answered by gemini/…" detail |
| 4 | Chat | Agent run mid-flight — trace timeline expanded (tool_call → tool_result) |
| 5 | Chat | Degraded-mode message: "AI unavailable — showing most relevant passages" |
| 6 | Chat | Recorded replay in progress — "Recorded replay — not a live model call" chip |
| 7 | Knowledge Base | File list incl. CSV, transcript, report; status badges |
| 8 | Ask-your-data | CSV question with returned chart/table |
| 9 | Memory page | Saved memories with forget action |
| 10 | Study page | Deck stats + due cards |
| 11 | Usage dashboard | Per-provider breakdown + daily cap remaining |
| 12 | `/health` JSON | providers block (state closed, models listed) — text shot fine |

## Recording (30–60 s)

Follow `docs/DEMO_SCRIPT.md` beats 2–4: demo login → cited answer → agent trace → chart. Keep cursor on the citation chips and trace timeline.

## Automation (optional)

Playwright is **not** a dependency. If you want scripted captures, install it locally as a dev-only tool (`npm i -D playwright` in a scratch checkout or run `npx playwright@latest`) — never commit it to `dependencies`/Render build. A simple capture script can log in via `POST /api/v1/auth/demo` and save shots to `docs/media/`; re-run `node scripts/seed-demo.js` first for a clean state.
