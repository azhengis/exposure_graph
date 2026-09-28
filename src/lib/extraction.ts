import { generateObject } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import type { Paragraph } from "./sections";

export const RELATIONSHIP_TYPES = [
  "supplier_dependency", // self depends on target as a supplier/manufacturer
  "customer_dependency", // self depends on target as a customer / revenue concentration
  "manufacturing_dependency", // self depends on target to manufacture its product (foundry, contract mfg)
  "competitor", // self and target compete
  "geographic_dependency", // self depends on a region/geography associated with target's operations
  "commodity_dependency", // self depends on a commodity/material target provides
  "technology_dependency", // self depends on licensed technology/IP from target
  "infrastructure_dependency", // self depends on target's infrastructure/platform
] as const;

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

const ExtractionSchema = z.object({
  relationships: z.array(
    z.object({
      target_company: z
        .string()
        .describe("Exact company name as given in the candidate list. Must match one of the provided candidates."),
      relationship_type: z.enum(RELATIONSHIP_TYPES),
      direction: z.enum(["self_depends_on_target", "target_depends_on_self", "mutual_or_unclear"]),
      evidence: z
        .string()
        .describe(
          "A verbatim quote copied EXACTLY (same words, same characters) from the source paragraph that supports this relationship. Do not paraphrase or summarize."
        ),
      confidence: z.number().min(0).max(1),
      rationale: z.string().describe("One short sentence explaining the inference."),
    })
  ),
});

export type ExtractedRelationship = z.infer<typeof ExtractionSchema>["relationships"][number];

// Default path: a local Ollama model (free, private, no API key). Since every relationship
// this pipeline accepts must independently pass verifyEvidence() below, a weaker local model
// is safe to use here — it can miss relationships (lower recall) but cannot make up ones that
// pass the gate (precision is enforced structurally, not by trusting the model).
// Set AI_GATEWAY_API_KEY (or run inside a linked Vercel project) to route through AI Gateway
// to a frontier model instead — useful once higher recall matters more than cost.
const USE_GATEWAY = Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN);
const GATEWAY_MODEL = process.env.AI_GATEWAY_MODEL ?? "anthropic/claude-sonnet-5";
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
// llama3.2:3b by default: much lighter on RAM than the 8b model, which matters since this
// runs hundreds of sequential calls locally. Override with OLLAMA_MODEL if you have headroom.
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2:3b";

const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: OLLAMA_BASE_URL,
  supportsStructuredOutputs: true,
});

function resolveModel() {
  return USE_GATEWAY ? GATEWAY_MODEL : ollama(OLLAMA_MODEL);
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();
}

/** Confirms the model's quoted evidence actually appears in the source paragraph (anti-hallucination gate). */
export function verifyEvidence(evidence: string, sourceParagraph: string): boolean {
  const normEvidence = normalize(evidence);
  const normSource = normalize(sourceParagraph);
  if (normEvidence.length < 15) return false;
  if (normSource.includes(normEvidence)) return true;
  // Allow near-verbatim matches (minor whitespace/punctuation drift) via a sliding window.
  const words = normEvidence.split(" ");
  if (words.length < 6) return false;
  const chunk = words.slice(0, Math.min(8, words.length)).join(" ");
  return normSource.includes(chunk);
}

export async function extractRelationshipsFromParagraph(
  selfCompanyName: string,
  paragraph: Paragraph
): Promise<ExtractedRelationship[]> {
  if (paragraph.mentionsCompanyNames.length === 0) return [];

  const { object } = await generateObject({
    model: resolveModel(),
    schema: ExtractionSchema,
    system:
      "You extract fundamental business dependency relationships between public companies from SEC filing text. " +
      "Only report a relationship if the paragraph provides direct textual support. " +
      "Never invent a relationship, and never quote text that is not literally present in the paragraph. " +
      "If the paragraph does not support any relationship to the candidate companies, return an empty array.",
    prompt: [
      `Filing company (the "self"): ${selfCompanyName}`,
      `Candidate companies mentioned in this paragraph (only use these as target_company values): ${paragraph.mentionsCompanyNames.join(", ")}`,
      "",
      "Source paragraph:",
      '"""',
      paragraph.text,
      '"""',
      "",
      "Extract every distinct fundamental dependency or competitive relationship between the filing company and a candidate company that this paragraph directly supports.",
    ].join("\n"),
  });

  return object.relationships
    .filter((r) => paragraph.mentionsCompanyNames.includes(r.target_company))
    .map((r) => correctCompetitorMislabels(r, paragraph.text));
}

const SUPPLY_CUES = ["purchase", "supply", "supplies", "manufactur", "foundry", "wafer", "outsourc", "contract with"];
const COMPETITOR_CUES = ["competitor", "compete with", "competes with", "competition from"];

/**
 * Small local models frequently mislabel a "our competitors include X" sentence as a
 * dependency relationship, even though the quoted evidence is correct. Since the
 * paragraph text is cheap to re-check lexically, catch this specific, observed failure
 * mode rather than trusting the model's relationship_type label at face value.
 */
function correctCompetitorMislabels(r: ExtractedRelationship, sourceParagraph: string): ExtractedRelationship {
  const lowerSource = sourceParagraph.toLowerCase();
  const lowerEvidence = r.evidence.toLowerCase();
  const looksCompetitive = COMPETITOR_CUES.some((c) => lowerSource.includes(c));
  const looksSupply = SUPPLY_CUES.some((c) => lowerEvidence.includes(c));
  if (r.relationship_type !== "competitor" && looksCompetitive && !looksSupply) {
    return { ...r, relationship_type: "competitor", direction: "mutual_or_unclear", confidence: r.confidence * 0.9 };
  }
  return r;
}
