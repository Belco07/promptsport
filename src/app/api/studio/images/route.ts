import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/lib/auth";
import { canAccessStudio } from "@/lib/roles";

export const runtime = "nodejs";

async function permitted() {
  const session = await auth();
  return Boolean(session?.user?.id && canAccessStudio(session.user.role));
}

export async function GET() {
  if (!await permitted()) return NextResponse.json({ error: "Connectez-vous au Studio." }, { status: 401 });
  const direct = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  if (!direct && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Le stockage des images n’est pas configuré. Vérifiez BLOB_READ_WRITE_TOKEN dans Vercel puis redéployez." }, { status: 503 });
  }
  return NextResponse.json({ direct }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as HandleUploadBody;
    const result = await handleUpload({
      request, body,
      onBeforeGenerateToken: async pathname => {
        if (!await permitted()) throw new Error("Connectez-vous au Studio.");
        if (!/^uploads\/[a-f0-9-]{36}\.(png|jpg|webp|gif)$/.test(pathname)) throw new Error("Nom de fichier invalide.");
        return {
          allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
          maximumSizeInBytes: 5 * 1024 * 1024,
          addRandomSuffix: false,
          allowOverwrite: false,
          validUntil: Date.now() + 10 * 60 * 1000,
        };
      },
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Autorisation d’upload impossible. Vérifiez votre session et la configuration Blob." }, { status: 400 });
  }
}
