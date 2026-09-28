import { NextResponse } from "next/server";
import { runPropagation, type Substitutability } from "@/lib/propagation";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json();
  const cik = String(body.cik ?? "");
  const severity = typeof body.severity === "number" ? body.severity : 0.7;
  const substitutability: Substitutability = ["low", "medium", "high"].includes(body.substitutability)
    ? body.substitutability
    : "low";
  const maxHops = typeof body.maxHops === "number" ? body.maxHops : 3;

  if (!cik) {
    return NextResponse.json({ error: "cik is required" }, { status: 400 });
  }

  const report = runPropagation({ cik, severity, substitutability, maxHops });
  return NextResponse.json(report);
}
