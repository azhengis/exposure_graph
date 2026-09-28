import { COMPANY_UNIVERSE } from "./companies";

const DEPENDENCY_KEYWORDS = [
  "supplier",
  "suppliers",
  "supply chain",
  "customer",
  "customers",
  "manufactur",
  "foundry",
  "foundries",
  "depend",
  "reliance",
  "rely",
  "concentrat",
  "sole source",
  "single source",
  "single-source",
  "sole-source",
  "wafer",
  "fabrication",
  " fab ",
  "capacity",
  "contract with",
  "purchase from",
  "purchases from",
  "sells to",
  "sold to",
  "revenue from",
  "accounted for",
  "% of our",
  "% of net revenue",
  "% of total revenue",
  "outsourc",
  "third-party",
  "third party",
  "geographic concentration",
  "export restriction",
  "license",
];

export type Paragraph = {
  text: string;
  mentionsCompanyNames: string[];
};

// Executive-bio sentences ("Mr. X served as CFO of Company Y before joining us in 2013")
// name other companies constantly in 10-Ks (officer biography sections) but describe a
// person's employment history, not a corporate dependency. Filtered out before scoring
// so the extraction model never sees them as candidates.
const BIO_EXCLUSION_PATTERN =
  /\b(Mr\.|Ms\.|Dr\.)\s+[A-Z][a-zA-Z'-]+.{0,80}\b(served as|served in|previously served|prior to joining|before joining|joined the company|held various|has served)/i;

function isExecutiveBio(text: string): boolean {
  return BIO_EXCLUSION_PATTERN.test(text);
}

function splitIntoParagraphs(text: string): string[] {
  const lines = text.split("\n");
  const paragraphs: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) {
      paragraphs.push(buf.join(" ").replace(/\s{2,}/g, " ").trim());
      buf = [];
    }
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    buf.push(trimmed);
    // Heuristic: lines ending in a sentence terminator often close a paragraph
    // in the flattened text produced by fetchFilingText.
    if (/[.;:]$/.test(trimmed) && buf.join(" ").length > 300) {
      flush();
    }
  }
  flush();
  return paragraphs.filter((p) => p.length >= 120 && p.length <= 4000);
}

/**
 * Selects candidate paragraphs likely to describe supplier/customer/manufacturing/
 * geographic dependency relationships, so the LLM extraction step only sees
 * relevant, evidence-bearing text (and cost/noise stays bounded).
 */
export function selectCandidateParagraphs(
  fullText: string,
  excludeSelfName: string,
  maxParagraphs = 40
): Paragraph[] {
  const otherNames = COMPANY_UNIVERSE.filter((c) => c.name !== excludeSelfName).map((c) => ({
    name: c.name,
    ticker: c.ticker,
    // short form, e.g. "Broadcom" from "Broadcom Inc."
    short: c.name.split(/\s+(Inc\.?|Corp\.?|Ltd\.?|Co\.?|NV|Technologies|Holding)\b/)[0].trim(),
  }));

  const paragraphs = splitIntoParagraphs(fullText);
  const scored: (Paragraph & { score: number })[] = [];

  for (const text of paragraphs) {
    if (isExecutiveBio(text)) continue;
    const lower = text.toLowerCase();
    let score = 0;
    for (const kw of DEPENDENCY_KEYWORDS) {
      if (lower.includes(kw)) score += 1;
    }
    const mentions: string[] = [];
    for (const other of otherNames) {
      if (
        other.short.length > 3 &&
        (text.includes(other.short) || new RegExp(`\\b${other.ticker}\\b`).test(text))
      ) {
        mentions.push(other.name);
        score += 3;
      }
    }
    if (score > 0) {
      scored.push({ text, mentionsCompanyNames: mentions, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxParagraphs).map(({ text, mentionsCompanyNames }) => ({
    text,
    mentionsCompanyNames,
  }));
}
