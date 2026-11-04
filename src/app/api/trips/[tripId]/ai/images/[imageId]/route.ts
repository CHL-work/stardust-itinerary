import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readAiRequestImage } from "@/lib/ai/image-store";
import { apiError } from "@/lib/app/http";
import { getAuthConfig } from "@/lib/auth/config";
import { requireAuthenticatedSession } from "@/lib/auth/web";
import { getPool } from "@/lib/db/pool";

export async function GET(request: NextRequest, { params }: { params: Promise<{ tripId: string; imageId: string }> }) {
  try {
    const config = getAuthConfig();
    const session = await requireAuthenticatedSession(request, config);
    const { tripId, imageId } = z.object({ tripId: z.uuid(), imageId: z.uuid() }).parse(await params);
    const result = await readAiRequestImage(getPool(config), session, tripId, imageId);
    return new NextResponse(new Uint8Array(result.data), { headers: {
      "cache-control": "private, no-store", "content-type": result.mediaType,
      "x-content-type-options": "nosniff", "content-disposition": 'inline; filename="image.jpg"',
      "content-security-policy": "default-src 'none'; sandbox",
    } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("cache-control", "private, no-store");
    return response;
  }
}
