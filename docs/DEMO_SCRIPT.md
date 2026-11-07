# Demo Script — 2 minutes

**Setup:** `DEMO_MODE=true` deployment → login page → **"Try the demo"** (one click, no signup).
The demo workspace is pre-seeded: reliability report, security policy, a timestamped meeting transcript, a CSV, an ops runbook, a study deck, and saved memories.

**If all providers are quota-exhausted:** use the **"Replay recorded demo"** chips under the chat input — they stream a recorded run through the exact same SSE path and UI (labelled "Recorded replay, not a live model call"). Everything else in this script still works.

## Beats

1. **North star (0:00–0:10).** "This is Quantum — an AI second brain that cites its sources and shows its work. Watch for three things: citations, the model label, and measured quality."

2. **Cited RAG answer (0:10–0:35).** Ask: *"What did the team decide about the storage migration?"*
   - Say: "It pulled the answer from a meeting transcript — see the timestamp chip; clicking it seeks to 12:40 in the audio minutes. Under the answer it says which provider and model wrote it."

3. **Agent run with visible trace (0:35–1:05).** Toggle **Agent mode**. Ask: *"What was the fix for ERR-8821-C and is it verified?"*
   - Say: "Watch the trace timeline — it searched the knowledge base, then pulled the document overview before answering. Tool calls are capped, owner-scoped, and every result is injection-scanned."

4. **Ask your data (1:05–1:25).** Uploads are disabled on demo — open **incident-metrics.csv** in Knowledge Base → **Ask data**: *"How did error budget consumption trend?"*
   - Say: "The model returns a validated chart spec — it never writes executable code, so a bad spec can't run arbitrary queries."

5. **Trust layer (1:25–1:50).** Open the Memory page + Study deck.
   - Say: "Memories are extracted only from what *I* write — a poisoned PDF can't plant them. The eval suite measures this: injection-safety is 100% on the committed baseline."
   - Point at the Quality section on `/welcome`: "Every number on that page comes from a committed eval report, with the provider and model named."

6. **Close (1:50–2:00).** "When every provider is out of quota, it doesn't die — it degrades to extractive answers with citations. That's the difference between a demo and a product."

## 30-second version

> "Quantum is a second-brain RAG workspace. It cites every claim to the file, page, or timestamp it came from, shows which model answered, runs an auditable agent loop, and measures its own quality against committed eval baselines. And when the free-tier quota runs out, it degrades to extractive answers instead of a 500."

## Fallback path (zero quota)

1. Login page → **Try the demo**.
2. Chat → **Replay recorded demo** chips: *Cited RAG answer* → *Agent run with visible trace* → *Ask-your-data chart*.
3. KB browse, Memory page, Study review, exports — all work with no AI at all.
