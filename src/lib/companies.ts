export type CompanyDef = {
  cik: string; // 10-digit zero-padded
  ticker: string;
  name: string;
  sector: string;
};

// Seed universe: semiconductor / AI-infrastructure ecosystem.
// CIKs verified against SEC's company_tickers.json (data.sec.gov) on 2026-09-27.
export const COMPANY_UNIVERSE: CompanyDef[] = [
  { cik: "0001046179", ticker: "TSM", name: "Taiwan Semiconductor Manufacturing Co Ltd", sector: "Foundry" },
  { cik: "0001045810", ticker: "NVDA", name: "NVIDIA Corp", sector: "Semiconductor Design" },
  { cik: "0000002488", ticker: "AMD", name: "Advanced Micro Devices Inc", sector: "Semiconductor Design" },
  { cik: "0000320193", ticker: "AAPL", name: "Apple Inc.", sector: "Devices" },
  { cik: "0001730168", ticker: "AVGO", name: "Broadcom Inc.", sector: "Semiconductor Design" },
  { cik: "0000804328", ticker: "QCOM", name: "QUALCOMM Inc", sector: "Semiconductor Design" },
  { cik: "0000937966", ticker: "ASML", name: "ASML Holding NV", sector: "Semiconductor Equipment" },
  { cik: "0000006951", ticker: "AMAT", name: "Applied Materials Inc", sector: "Semiconductor Equipment" },
  { cik: "0000707549", ticker: "LRCX", name: "Lam Research Corp", sector: "Semiconductor Equipment" },
  { cik: "0000723125", ticker: "MU", name: "Micron Technology Inc", sector: "Memory" },
  { cik: "0000050863", ticker: "INTC", name: "Intel Corp", sector: "Semiconductor Design / Foundry" },
  { cik: "0001571996", ticker: "DELL", name: "Dell Technologies Inc.", sector: "Server OEM" },
  { cik: "0000789019", ticker: "MSFT", name: "Microsoft Corp", sector: "Cloud Infrastructure" },
];

export function findCompany(cik: string): CompanyDef | undefined {
  return COMPANY_UNIVERSE.find((c) => c.cik === cik);
}

export function findByTicker(ticker: string): CompanyDef | undefined {
  return COMPANY_UNIVERSE.find((c) => c.ticker.toLowerCase() === ticker.toLowerCase());
}
