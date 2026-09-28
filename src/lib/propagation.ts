import { buildGraph } from "./graph";
import { findCompany } from "./companies";

export type Substitutability = "low" | "medium" | "high";

export type ShockInput = {
  cik: string;
  severity: number; // 0-1, how severe the shock is at the source
  substitutability: Substitutability;
  maxHops?: number;
};

const SUBSTITUTABILITY_FACTOR: Record<Substitutability, number> = {
  low: 1.0, // hard to substitute -> full impact passes through
  medium: 0.6,
  high: 0.3,
};

const RELATIONSHIP_WEIGHT: Record<string, number> = {
  manufacturing_dependency: 1.0,
  supplier_dependency: 0.9,
  commodity_dependency: 0.8,
  technology_dependency: 0.75,
  infrastructure_dependency: 0.7,
  geographic_dependency: 0.65,
  customer_dependency: 0.5,
  competitor: 0, // handled separately, not propagated as exposure
};

const HOP_DECAY = 0.6;

export type ExposedNode = {
  cik: string;
  name: string;
  hop: number;
  score: number;
  band: "High" | "Medium" | "Low";
  paths: {
    via: string; // cik of the intermediate node this path came through
    edgeRelId: number;
    relationshipType: string;
    confidence: number;
  }[];
};

export type ExposureReport = {
  shock: ShockInput;
  shockedCompany: { cik: string; name: string } | null;
  directExposure: ExposedNode[];
  secondOrderExposure: ExposedNode[];
  furtherExposure: ExposedNode[];
  competitiveEffects: { cik: string; name: string; edgeRelId: number; evidenceConfidence: number }[];
  notes: string[];
};

function classify(score: number): "High" | "Medium" | "Low" {
  if (score >= 0.4) return "High";
  if (score >= 0.15) return "Medium";
  return "Low";
}

export function runPropagation(input: ShockInput): ExposureReport {
  const { graph, rows } = buildGraph();
  const maxHops = input.maxHops ?? 3;
  const subFactor = SUBSTITUTABILITY_FACTOR[input.substitutability];

  const shockedCompany = findCompany(input.cik);
  const notes: string[] = [];
  if (!shockedCompany) notes.push(`Unknown company CIK ${input.cik}: not in the seed universe.`);

  const exposedByCik = new Map<string, ExposedNode>();
  const competitiveEffects: ExposureReport["competitiveEffects"] = [];

  if (!graph.hasNode(input.cik)) {
    return {
      shock: input,
      shockedCompany: shockedCompany ? { cik: shockedCompany.cik, name: shockedCompany.name } : null,
      directExposure: [],
      secondOrderExposure: [],
      furtherExposure: [],
      competitiveEffects: [],
      notes: [...notes, "Company not present in the current graph."],
    };
  }

  // Reverse-BFS: an edge A -> B means "A depends on B", so a shock at B propagates to A.
  // We walk B's in-edges to find dependents, then their in-edges, etc.
  let frontier: { cik: string; upstreamScore: number }[] = [{ cik: input.cik, upstreamScore: input.severity }];
  const visitedAtHop = new Map<string, number>();

  for (let hop = 1; hop <= maxHops; hop++) {
    const nextFrontier: { cik: string; upstreamScore: number }[] = [];

    for (const { cik: targetCik, upstreamScore } of frontier) {
      const inEdges = graph.inEdges(targetCik);
      for (const edgeKey of inEdges) {
        const dependentCik = graph.source(edgeKey);
        // The shocked company can never be "exposed" to its own shock. A single mislabeled
        // direction on an extracted relationship could otherwise fabricate a cycle back to it.
        if (dependentCik === input.cik) continue;
        const attrs = graph.getEdgeAttributes(edgeKey);
        const relType = attrs.relationshipType as string;
        const confidence = attrs.confidence as number;

        if (relType === "competitor") {
          if (targetCik === input.cik || hop === 1) {
            competitiveEffects.push({
              cik: dependentCik,
              name: findCompany(dependentCik)?.name ?? dependentCik,
              edgeRelId: attrs.relId as number,
              evidenceConfidence: confidence,
            });
          }
          continue;
        }

        const weight = RELATIONSHIP_WEIGHT[relType] ?? 0.5;
        const decay = Math.pow(HOP_DECAY, hop - 1);
        const edgeScore = upstreamScore * subFactor * weight * confidence * decay;

        if (edgeScore <= 0.01) continue;

        const existing = exposedByCik.get(dependentCik);
        const pathEntry = {
          via: targetCik,
          edgeRelId: attrs.relId as number,
          relationshipType: relType,
          confidence,
        };

        if (existing) {
          existing.score = Math.max(existing.score, edgeScore);
          existing.hop = Math.min(existing.hop, hop);
          existing.paths.push(pathEntry);
        } else {
          exposedByCik.set(dependentCik, {
            cik: dependentCik,
            name: findCompany(dependentCik)?.name ?? dependentCik,
            hop,
            score: edgeScore,
            band: classify(edgeScore),
            paths: [pathEntry],
          });
        }

        if (!visitedAtHop.has(dependentCik) && dependentCik !== input.cik) {
          visitedAtHop.set(dependentCik, hop);
          nextFrontier.push({ cik: dependentCik, upstreamScore: edgeScore });
        }
      }
    }

    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  for (const node of exposedByCik.values()) {
    node.band = classify(node.score);
  }

  const all = Array.from(exposedByCik.values()).sort((a, b) => b.score - a.score);
  const directExposure = all.filter((n) => n.hop === 1);
  const secondOrderExposure = all.filter((n) => n.hop === 2);
  const furtherExposure = all.filter((n) => n.hop >= 3);

  if (rows.length === 0) {
    notes.push("No relationships in the database yet — run the ingestion pipeline first.");
  }

  return {
    shock: input,
    shockedCompany: shockedCompany ? { cik: shockedCompany.cik, name: shockedCompany.name } : null,
    directExposure,
    secondOrderExposure,
    furtherExposure,
    competitiveEffects,
    notes,
  };
}
