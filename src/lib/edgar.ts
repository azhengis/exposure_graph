import * as cheerio from "cheerio";

// SEC EDGAR fair-access policy requires a descriptive User-Agent on every request.
// This is a generic project identifier, not tied to any individual.
const USER_AGENT = "FundamentalExposureGraph/1.0 (research project; contact: research@fundamentalexposuregraph.dev)";

async function secFetch(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Encoding": "gzip, deflate",
      Host: new URL(url).host,
    },
  });
  if (!res.ok) {
    throw new Error(`SEC EDGAR request failed (${res.status}) for ${url}`);
  }
  return res;
}

export type SecFiling = {
  accessionNumber: string;
  filingDate: string;
  reportDate: string;
  form: string;
  primaryDocument: string;
  primaryDocDescription: string;
};

type SubmissionsResponse = {
  cik: string;
  name: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      reportDate: string[];
      form: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
    };
  };
};

export async function getSubmissions(cik: string): Promise<SubmissionsResponse> {
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const res = await secFetch(url);
  return (await res.json()) as SubmissionsResponse;
}

/** Returns the most recent filings matching any of the given form types (e.g. ["10-K","20-F"]). */
export function extractRecentFilings(
  submissions: SubmissionsResponse,
  formTypes: string[],
  limit = 1
): SecFiling[] {
  const { recent } = submissions.filings;
  const matches: SecFiling[] = [];
  for (let i = 0; i < recent.form.length; i++) {
    if (formTypes.includes(recent.form[i])) {
      matches.push({
        accessionNumber: recent.accessionNumber[i],
        filingDate: recent.filingDate[i],
        reportDate: recent.reportDate[i],
        form: recent.form[i],
        primaryDocument: recent.primaryDocument[i],
        primaryDocDescription: recent.primaryDocDescription[i],
      });
    }
  }
  matches.sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1));
  return matches.slice(0, limit);
}

export function primaryDocUrl(cik: string, filing: SecFiling): string {
  const accNoDashes = filing.accessionNumber.replace(/-/g, "");
  const cikNum = String(Number(cik));
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDashes}/${filing.primaryDocument}`;
}

/** Fetches a filing's primary document and returns plain text (HTML tags stripped). */
export async function fetchFilingText(url: string): Promise<string> {
  const res = await secFetch(url);
  const html = await res.text();
  const $ = cheerio.load(html);
  $("script, style").remove();
  // Preserve paragraph/heading boundaries as newlines before stripping tags.
  $("p, div, br, tr, h1, h2, h3, h4, h5, h6, li").after("\n");
  const text = $("body").text();
  return text
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
