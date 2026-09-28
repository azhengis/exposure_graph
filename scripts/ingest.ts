/**
 * Ingestion pipeline: for each company in the seed universe, fetch its most recent
 * annual filing (10-K, or 20-F for foreign private issuers) from SEC EDGAR,
 * select candidate paragraphs describing supplier/customer/manufacturing/geographic
 * dependencies, run LLM extraction with an evidence-verbatim requirement, verify the
 * quoted evidence actually appears in the source text, and persist verified
 * relationships to the local SQLite graph database.
 *
 * Usage: npx tsx scripts/ingest.ts [ticker ...]
 *   (with no args, ingests the entire seed universe)
 *
 * Requires AI Gateway auth: AI_GATEWAY_API_KEY env var, or a linked Vercel project
 * (`vercel link` + `vercel env pull .env.local`) providing VERCEL_OIDC_TOKEN.
 */
import "dotenv/config";
import { COMPANY_UNIVERSE, findByTicker, type CompanyDef } from "../src/lib/companies";
import { getSubmissions, extractRecentFilings, primaryDocUrl, fetchFilingText, sleep } from "../src/lib/edgar";
import { selectCandidateParagraphs } from "../src/lib/sections";
import { extractRelationshipsFromParagraph, verifyEvidence } from "../src/lib/extraction";
import { getDb } from "../src/lib/db";

const ANNUAL_FORM_TYPES = ["10-K", "20-F"];

async function ingestCompany(company: CompanyDef) {
  console.log(`\n=== ${company.ticker} (${company.name}) ===`);
  const db = getDb();
  db.prepare(
    `INSERT INTO companies (cik, ticker, name, sector) VALUES (?, ?, ?, ?)
     ON CONFLICT(cik) DO UPDATE SET ticker=excluded.ticker, name=excluded.name, sector=excluded.sector`
  ).run(company.cik, company.ticker, company.name, company.sector);

  const submissions = await getSubmissions(company.cik);
  await sleep(150);
  const [filing] = extractRecentFilings(submissions, ANNUAL_FORM_TYPES, 1);
  if (!filing) {
    console.log(`  no ${ANNUAL_FORM_TYPES.join("/")} filing found, skipping`);
    return;
  }
  const docUrl = primaryDocUrl(company.cik, filing);
  console.log(`  filing: ${filing.form} dated ${filing.filingDate} -> ${docUrl}`);

  const existing = db
    .prepare(`SELECT id FROM filings WHERE cik = ? AND accession_number = ?`)
    .get(company.cik, filing.accessionNumber) as { id: number } | undefined;

  let filingId: number;
  if (existing) {
    filingId = existing.id;
  } else {
    const info = db
      .prepare(
        `INSERT INTO filings (cik, form, filing_date, report_date, accession_number, doc_url, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(company.cik, filing.form, filing.filingDate, filing.reportDate, filing.accessionNumber, docUrl, new Date().toISOString());
    filingId = info.lastInsertRowid as number;
  }

  const relCount = (
    db.prepare(`SELECT count(*) as c FROM relationships WHERE filing_id = ?`).get(filingId) as { c: number }
  ).c;

  if (relCount > 0) {
    console.log(`  filing already ingested with ${relCount} relationships, skipping`);
  } else {
    const text = await fetchFilingText(docUrl);
    await sleep(150);
    console.log(`  fetched ${text.length.toLocaleString()} chars of filing text`);

    const paragraphs = selectCandidateParagraphs(text, company.name, 25);
    console.log(`  selected ${paragraphs.length} candidate paragraphs for extraction`);

    let extractedCount = 0;
    let verifiedCount = 0;
    for (const [idx, p] of paragraphs.entries()) {
      process.stdout.write(`  [${idx + 1}/${paragraphs.length}] extracting...\r`);
      try {
        const rels = await extractRelationshipsFromParagraph(company.name, p);
        for (const r of rels) {
          extractedCount++;
          const target = findByTicker(r.target_company) ?? COMPANY_UNIVERSE.find((c) => c.name === r.target_company);
          if (!target) continue;
          const verified = verifyEvidence(r.evidence, p.text) && r.confidence >= 0.3;
          if (!verified) continue;
          verifiedCount++;
          db.prepare(
            `INSERT INTO relationships
               (source_cik, target_cik, relationship_type, direction_note, evidence_text, confidence, evidence_verified, filing_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
          ).run(
            company.cik,
            target.cik,
            r.relationship_type,
            r.direction,
            r.evidence,
            r.confidence,
            filingId,
            new Date().toISOString()
          );
        }
      } catch (err) {
        console.error(`  extraction error on a paragraph: ${(err as Error).message}`);
      }
    }
    console.log(`  extracted ${extractedCount} candidate relationships, ${verifiedCount} passed evidence verification`);
  }
}

async function main() {
  const tickers = process.argv.slice(2);
  const targets = tickers.length
    ? tickers.map((t) => findByTicker(t)).filter((c): c is CompanyDef => !!c)
    : COMPANY_UNIVERSE;

  for (const company of targets) {
    try {
      await ingestCompany(company);
    } catch (err) {
      console.error(`Failed to ingest ${company.ticker}: ${(err as Error).message}`);
    }
  }
  console.log("\nDone.");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
