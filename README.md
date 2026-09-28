# Fundamental Exposure Graph

An evidence-backed corporate dependency graph and shock-propagation research tool.

Instead of asking "will company X's stock go up," this asks: **if something materially
changes at company X, which other companies are fundamentally exposed, through what
relationship, and why?** Every edge in the graph must be traceable to a verbatim quote
from a real SEC filing — the system does not let an LLM simply invent the graph.

## How it works

```
SEC EDGAR (10-K / 20-F)
      │  fetch + strip to plain text
      ▼
candidate paragraph selection   (keyword + known-company-name filter,
      │                          executive-bio sentences excluded)
      ▼
LLM relationship extraction     (local Ollama by default; verbatim evidence
      │                          quote required, not a paraphrase)
      ▼
evidence verification gate      (reject unless the quote is literally
      │                          present in the source paragraph)
      ▼
SQLite graph DB  (companies / filings / relationships+evidence)
      │
      ├─▶ graph analytics (pagerank, betweenness — graphology)
      └─▶ shock propagation engine (reverse-BFS with hop decay,
              confidence weighting, substitutability factor)
                      │
                      ▼
               Web UI: graph view, scenario controls,
               exposure report, evidence drill-down
```

The core design principle: **the model's output is never trusted at face value.**
- Every extracted relationship must include a quote copied verbatim from the source
  paragraph. `verifyEvidence()` (`src/lib/extraction.ts`) independently re-checks that
  quote against the real filing text and discards anything that doesn't match. This
  means even a small/free local model is safe to use for extraction — it can miss
  relationships (lower recall), but it structurally cannot fabricate ones that survive
  the gate (precision is enforced by code, not by trusting the model).
- Graph edge *direction* deliberately ignores the model's free-form `direction` label.
  A 10-K discloses the filer's own dependencies, essentially never the counterparty's
  dependency on the filer — so `source depends on target` is used unconditionally for
  every extracted relationship type except `competitor`. Trusting the model's own
  direction label instead let one mislabeled extraction fabricate a reversed edge
  during testing (see `src/lib/graph.ts` for the full rationale).

## Seed universe

13 companies across the semiconductor / AI-infrastructure supply chain (`src/lib/companies.ts`):
TSMC, NVIDIA, AMD, Apple, Broadcom, Qualcomm, ASML, Applied Materials, Lam Research,
Micron, Intel, Dell, Microsoft. CIKs verified against SEC's `company_tickers.json`.

## Running it

```bash
npm install
npm run ingest        # fetch filings + extract relationships (see below)
npm run dev           # http://localhost:3000
```

`npm run ingest [TICKER ...]` pulls each company's most recent annual filing (10-K, or
20-F for foreign private issuers), fetches and caches it, selects candidate paragraphs,
runs extraction, and stores verified relationships. It's idempotent — a filing already
ingested with relationships is skipped; re-run any time to pick up new filings or retry
companies that returned nothing.

### Extraction model

Defaults to a **local Ollama model** (`llama3.2:3b`) — free, private, no API key. Since
the evidence-verification gate protects precision independent of model quality, this is
a reasonable default; recall (how many real relationships get found) is the main thing
you trade away versus a frontier model.

To use a larger local model or a hosted model instead:

```bash
OLLAMA_MODEL=llama3.1:8b npm run ingest        # larger local model

# or route through Vercel AI Gateway to a frontier model:
AI_GATEWAY_API_KEY=... npm run ingest          # or run inside a linked Vercel project
AI_GATEWAY_MODEL=anthropic/claude-sonnet-5 npm run ingest   # optional override
```

## Known limitations (read before trusting an edge)

This is a research MVP, not a finished product. The evidence layer means every claim is
checkable — but check it. Specifically observed with the default local model:

- **Relationship-type mislabeling.** The model occasionally tags a genuine competitor
  mention as a dependency (or vice versa). A lexical guard
  (`correctCompetitorMislabels` in `extraction.ts`) catches the most common case, but
  isn't exhaustive. Always read the quoted evidence, don't just trust the label.
- **Recall is low.** ~25 verified relationships across 13 companies from one filing
  each, ~25 candidate paragraphs per filing. Real coverage is much larger than that —
  raising `maxParagraphs` in `selectCandidateParagraphs` calls and/or using a stronger
  model will find more.
- **One filing per company.** Only the most recent 10-K/20-F is ingested. Older filings,
  10-Qs, and investor-day materials aren't covered.

## Project layout

- `src/lib/edgar.ts` — SEC EDGAR client (submissions, filing text fetch)
- `src/lib/sections.ts` — candidate paragraph selection + executive-bio filtering
- `src/lib/extraction.ts` — LLM extraction, evidence verification, model selection
- `src/lib/db.ts` — SQLite schema (`data/graph.db`, gitignored — rebuild via `npm run ingest`)
- `src/lib/graph.ts` — graph construction + centrality analytics
- `src/lib/propagation.ts` — shock propagation engine
- `scripts/ingest.ts` — ingestion pipeline entry point
- `src/components/ExposureGraph.tsx` — the UI (graph view, scenario controls, evidence panel)

## Next steps for a fuller version

- Higher-recall/precision extraction (bigger local model, or AI Gateway + a frontier model)
- Expand the seed universe and filing history (multiple years, 10-Qs)
- Historical-analog retrieval (embeddings over past disclosed shocks)
- A proper research write-up: methodology, case studies, and an
  information-at-the-time evaluation (build the graph from filings available *before*
  a historical shock, then check whether the companies it flagged match what actually
  got affected — avoiding hindsight leakage from later filings)
