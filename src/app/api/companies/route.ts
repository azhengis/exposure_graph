import { NextResponse } from "next/server";
import { COMPANY_UNIVERSE } from "@/lib/companies";

export async function GET() {
  return NextResponse.json({ companies: COMPANY_UNIVERSE });
}
