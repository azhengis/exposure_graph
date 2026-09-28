import Graph from "graphology";
import pagerank from "graphology-metrics/centrality/pagerank";
import betweenness from "graphology-metrics/centrality/betweenness";
import { getDb, type RelationshipRow, type FilingRow } from "./db";
import { COMPANY_UNIVERSE, findCompany } from "./companies";

export type EdgeData = {
  id: number;
  source: string;
  target: string;
  relationshipType: string;
  direction: string | null;
  evidence: string;
  confidence: number;
  verified: boolean;
  filing: { form: string; filingDate: string; docUrl: string } | null;
};

export type GraphPayload = {
  nodes: {
    cik: string;
    ticker: string;
    name: string;
    sector: string;
    pagerank: number;
    betweenness: number;
    inDegree: number;
    outDegree: number;
  }[];
  edges: EdgeData[];
};

export function loadRelationships(): (RelationshipRow & Pick<FilingRow, "form" | "filing_date" | "doc_url">)[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT r.*, f.form as form, f.filing_date as filing_date, f.doc_url as doc_url
       FROM relationships r JOIN filings f ON f.id = r.filing_id`
    )
    .all() as (RelationshipRow & Pick<FilingRow, "form" | "filing_date" | "doc_url">)[];
}

export function buildGraph(): { graph: Graph; rows: ReturnType<typeof loadRelationships> } {
  const graph = new Graph({ type: "directed", multi: true });
  for (const c of COMPANY_UNIVERSE) {
    graph.addNode(c.cik, { label: c.name });
  }
  const rows = loadRelationships();
  for (const r of rows) {
    // Edge direction in the graph always points from the dependent party to the party it depends on,
    // i.e. A -> B means "A depends on B" / "a shock at B propagates to A".
    //
    // Deliberately IGNORE the model's free-form `direction_note` field for orientation: a 10-K
    // filer discloses ITS OWN dependencies (risk factors, supplier/customer concentration), it
    // essentially never discloses "party X depends on us" from the other party's perspective. So
    // source_cik (the filer) depends on target_cik (the mentioned company) is the correct edge
    // orientation for every extracted relationship type. Trusting the model's own direction label
    // instead is what let one mislabeled extraction fabricate a reversed edge (and a false cycle
    // back into the shocked node) even though its evidence quote and relationship_type were fine.
    // direction_note is still stored and shown in the evidence panel for transparency.
    const from = r.source_cik;
    const to = r.target_cik;
    if (!graph.hasNode(from) || !graph.hasNode(to)) continue;
    graph.addEdgeWithKey(`rel-${r.id}`, from, to, {
      relId: r.id,
      relationshipType: r.relationship_type,
      confidence: r.confidence,
    });
  }
  return { graph, rows };
}

export function computeGraphPayload(): GraphPayload {
  const { graph, rows } = buildGraph();

  let pr: Record<string, number> = {};
  let bt: Record<string, number> = {};
  try {
    pr = pagerank(graph);
  } catch {
    pr = {};
  }
  try {
    bt = betweenness(graph);
  } catch {
    bt = {};
  }

  const nodes = COMPANY_UNIVERSE.map((c) => ({
    cik: c.cik,
    ticker: c.ticker,
    name: c.name,
    sector: c.sector,
    pagerank: pr[c.cik] ?? 0,
    betweenness: bt[c.cik] ?? 0,
    inDegree: graph.hasNode(c.cik) ? graph.inDegree(c.cik) : 0,
    outDegree: graph.hasNode(c.cik) ? graph.outDegree(c.cik) : 0,
  }));

  const edges: EdgeData[] = rows.map((r) => ({
    id: r.id,
    source: r.source_cik,
    target: r.target_cik,
    relationshipType: r.relationship_type,
    direction: r.direction_note,
    evidence: r.evidence_text,
    confidence: r.confidence,
    verified: !!r.evidence_verified,
    filing: { form: r.form, filingDate: r.filing_date, docUrl: r.doc_url },
  }));

  return { nodes, edges };
}

export function companyLabel(cik: string): string {
  return findCompany(cik)?.name ?? cik;
}
