"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type CompanyDef = { cik: string; ticker: string; name: string; sector: string };

type GraphEdge = {
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

type GraphPayload = {
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
  edges: GraphEdge[];
};

type ExposedNode = {
  cik: string;
  name: string;
  hop: number;
  score: number;
  band: "High" | "Medium" | "Low";
  paths: { via: string; edgeRelId: number; relationshipType: string; confidence: number }[];
};

type ExposureReport = {
  shock: { cik: string; severity: number; substitutability: string; maxHops: number };
  shockedCompany: { cik: string; name: string } | null;
  directExposure: ExposedNode[];
  secondOrderExposure: ExposedNode[];
  furtherExposure: ExposedNode[];
  competitiveEffects: { cik: string; name: string; edgeRelId: number; evidenceConfidence: number }[];
  notes: string[];
};

const SECTOR_COLUMN: Record<string, number> = {
  "Semiconductor Equipment": 0,
  Foundry: 1,
  Memory: 1,
  "Semiconductor Design / Foundry": 1,
  "Semiconductor Design": 2,
  Devices: 3,
  "Server OEM": 3,
  "Cloud Infrastructure": 4,
};

const BAND_COLOR: Record<string, string> = {
  High: "#dc2626",
  Medium: "#d97706",
  Low: "#65a30d",
};

const REL_LABEL: Record<string, string> = {
  supplier_dependency: "supplier dependency",
  customer_dependency: "customer dependency",
  manufacturing_dependency: "manufacturing dependency",
  competitor: "competitor",
  geographic_dependency: "geographic dependency",
  commodity_dependency: "commodity dependency",
  technology_dependency: "technology dependency",
  infrastructure_dependency: "infrastructure dependency",
};

export default function ExposureGraph() {
  const [companies, setCompanies] = useState<CompanyDef[]>([]);
  const [graph, setGraph] = useState<GraphPayload | null>(null);
  const [shockCik, setShockCik] = useState<string>("");
  const [severity, setSeverity] = useState(0.7);
  const [substitutability, setSubstitutability] = useState<"low" | "medium" | "high">("low");
  const [report, setReport] = useState<ExposureReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);

  useEffect(() => {
    fetch("/api/companies")
      .then((r) => r.json())
      .then((d) => {
        setCompanies(d.companies);
        if (d.companies[0]) setShockCik(d.companies[0].cik);
      });
    fetch("/api/graph")
      .then((r) => r.json())
      .then(setGraph);
  }, []);

  const runScenario = useCallback(async () => {
    if (!shockCik) return;
    setLoadingReport(true);
    setSelectedEdge(null);
    try {
      const res = await fetch("/api/scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cik: shockCik, severity, substitutability, maxHops: 3 }),
      });
      const data = await res.json();
      setReport(data);
    } finally {
      setLoadingReport(false);
    }
  }, [shockCik, severity, substitutability]);

  const bandByCik = useMemo(() => {
    const m = new Map<string, ExposedNode>();
    if (report) {
      for (const n of [...report.directExposure, ...report.secondOrderExposure, ...report.furtherExposure]) {
        m.set(n.cik, n);
      }
    }
    return m;
  }, [report]);

  const { nodes, edges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    if (!graph) return { nodes: [], edges: [] };

    const columnCounts: Record<number, number> = {};
    const rfNodes: Node[] = graph.nodes.map((n) => {
      const col = SECTOR_COLUMN[n.sector] ?? 2;
      const row = columnCounts[col] ?? 0;
      columnCounts[col] = row + 1;
      const exposure = bandByCik.get(n.cik);
      const isShock = n.cik === shockCik;
      const bg = isShock ? "#111827" : exposure ? BAND_COLOR[exposure.band] : "#e5e7eb";
      const color = isShock || exposure ? "#fff" : "#111827";
      return {
        id: n.cik,
        position: { x: col * 240, y: row * 110 },
        data: {
          label: (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontWeight: 700 }}>{n.ticker}</div>
              <div style={{ fontSize: 10, opacity: 0.85 }}>{exposure ? `${exposure.band} · hop ${exposure.hop}` : n.sector}</div>
            </div>
          ),
        },
        style: {
          background: bg,
          color,
          border: isShock ? "2px solid #111827" : "1px solid #9ca3af",
          borderRadius: 10,
          width: 150,
          fontSize: 12,
          padding: 6,
        },
      };
    });

    const rfEdges: Edge[] = graph.edges.map((e) => {
      const highlighted =
        !!report &&
        [...report.directExposure, ...report.secondOrderExposure, ...report.furtherExposure].some((n) =>
          n.paths.some((p) => p.edgeRelId === e.id)
        );
      return {
        id: `e-${e.id}`,
        source: e.source,
        target: e.target,
        label: REL_LABEL[e.relationshipType] ?? e.relationshipType,
        animated: highlighted,
        style: { stroke: highlighted ? "#dc2626" : "#9ca3af", strokeWidth: highlighted ? 2.5 : 1 },
        labelStyle: { fontSize: 9 },
        markerEnd: { type: MarkerType.ArrowClosed },
        data: { edge: e },
      };
    });

    return { nodes: rfNodes, edges: rfEdges };
  }, [graph, bandByCik, shockCik, report]);

  const onEdgeClick = useCallback((_: unknown, edge: Edge) => {
    setSelectedEdge((edge.data?.edge as GraphEdge) ?? null);
  }, []);

  const exposureList = (list: ExposedNode[], title: string) => (
    <div className="mb-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
        {title} ({list.length})
      </h3>
      {list.length === 0 && <p className="text-xs text-gray-400">None identified.</p>}
      <ul className="space-y-1">
        {list.map((n) => (
          <li key={n.cik} className="text-sm flex items-center justify-between gap-2 border rounded px-2 py-1">
            <span>{n.name}</span>
            <span
              className="text-xs font-medium px-2 py-0.5 rounded text-white"
              style={{ background: BAND_COLOR[n.band] }}
            >
              {n.band}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="flex h-full w-full">
      {/* Left: scenario controls */}
      <aside className="w-72 shrink-0 border-r p-4 overflow-y-auto">
        <h1 className="text-lg font-bold mb-1">Fundamental Exposure Graph</h1>
        <p className="text-xs text-gray-500 mb-4">Evidence-backed corporate dependency &amp; shock propagation</p>

        <label className="block text-xs font-semibold mb-1">Shock origin</label>
        <select
          className="w-full border rounded px-2 py-1 mb-3 text-sm"
          value={shockCik}
          onChange={(e) => setShockCik(e.target.value)}
        >
          {companies.map((c) => (
            <option key={c.cik} value={c.cik}>
              {c.name} ({c.ticker})
            </option>
          ))}
        </select>

        <label className="block text-xs font-semibold mb-1">Severity: {(severity * 100).toFixed(0)}%</label>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={severity}
          onChange={(e) => setSeverity(Number(e.target.value))}
          className="w-full mb-3"
        />

        <label className="block text-xs font-semibold mb-1">Substitutability</label>
        <select
          className="w-full border rounded px-2 py-1 mb-4 text-sm"
          value={substitutability}
          onChange={(e) => setSubstitutability(e.target.value as "low" | "medium" | "high")}
        >
          <option value="low">Low (hard to substitute)</option>
          <option value="medium">Medium</option>
          <option value="high">High (easy to substitute)</option>
        </select>

        <button
          onClick={runScenario}
          disabled={loadingReport || !shockCik}
          className="w-full bg-gray-900 text-white text-sm font-medium rounded px-3 py-2 disabled:opacity-50"
        >
          {loadingReport ? "Running…" : "Run scenario"}
        </button>

        {graph && graph.edges.length === 0 && (
          <p className="text-xs text-amber-600 mt-4 border border-amber-300 bg-amber-50 rounded p-2">
            No relationships loaded yet. Run <code>npm run ingest</code> to fetch SEC filings and build the
            evidence-backed graph.
          </p>
        )}

        {report && (
          <div className="mt-5 border-t pt-3">
            <h2 className="text-sm font-bold mb-2">
              Exposure report: {report.shockedCompany?.name ?? report.shock.cik}
            </h2>
            {exposureList(report.directExposure, "Direct exposure")}
            {exposureList(report.secondOrderExposure, "Second-order exposure")}
            {exposureList(report.furtherExposure, "Further exposure")}
            {report.competitiveEffects.length > 0 && (
              <div className="mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                  Competitive effects ({report.competitiveEffects.length})
                </h3>
                <ul className="space-y-1">
                  {report.competitiveEffects.map((c) => (
                    <li key={c.cik} className="text-sm border rounded px-2 py-1">
                      {c.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {report.notes.length > 0 && (
              <ul className="text-xs text-gray-500 list-disc pl-4">
                {report.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </aside>

      {/* Center: graph visualization */}
      <main className="flex-1 relative">
        <ReactFlow nodes={nodes} edges={edges} onEdgeClick={onEdgeClick} fitView proOptions={{ hideAttribution: true }}>
          <Background />
          <Controls />
        </ReactFlow>
      </main>

      {/* Right: evidence panel */}
      <aside className="w-96 shrink-0 border-l p-4 overflow-y-auto">
        <h2 className="text-sm font-bold mb-2">Evidence</h2>
        {!selectedEdge && (
          <p className="text-xs text-gray-500">
            Click a red (highlighted) edge in the graph, or any edge, to see the filing text supporting that
            relationship.
          </p>
        )}
        {selectedEdge && (
          <div className="text-sm space-y-2">
            <div>
              <span className="font-semibold">Relationship: </span>
              {REL_LABEL[selectedEdge.relationshipType] ?? selectedEdge.relationshipType}
            </div>
            <div className="text-xs text-gray-500">Confidence: {(selectedEdge.confidence * 100).toFixed(0)}%</div>
            <blockquote className="border-l-4 border-gray-300 pl-3 italic text-gray-700">
              &ldquo;{selectedEdge.evidence}&rdquo;
            </blockquote>
            {selectedEdge.filing && (
              <div className="text-xs text-gray-500">
                Source: {selectedEdge.filing.form} filed {selectedEdge.filing.filingDate}
                <br />
                <a
                  href={selectedEdge.filing.docUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 underline break-all"
                >
                  {selectedEdge.filing.docUrl}
                </a>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
