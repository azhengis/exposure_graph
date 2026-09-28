import { NextResponse } from "next/server";
import { computeGraphPayload } from "@/lib/graph";

export const dynamic = "force-dynamic";

export async function GET() {
  const payload = computeGraphPayload();
  return NextResponse.json(payload);
}
