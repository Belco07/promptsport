import Link from "next/link";
import { redirect } from "next/navigation";

import { createCampaign } from "@/app/backoffice/newsletter/campaigns/actions";
import { CampaignForm } from "@/app/backoffice/newsletter/campaigns/components/CampaignForm";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Création d'une campagne (WP11d).
 *
 * La page ne fait que charger les listes : toute la validation (sujet, liste
 * active, contenu) vit dans la Server Action, qui est un point d'entrée HTTP.
 */

export const dynamic = "force-dynamic";

export default async function NewCampaignPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/studio");
  }

  const lists = await prisma.newsletterList.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, active: true },
  });

  return (
    <div className="px-8 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-primary-900">Nouvelle campagne</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Le contenu est du HTML : la mise en page de l&apos;e-mail (bandeau, pied de page, lien de
        désabonnement) est ajoutée automatiquement à l&apos;envoi.
      </p>

      {lists.length === 0 ? (
        <p className="mt-6 max-w-3xl rounded-lg border border-accent-200 bg-accent-50 px-4 py-3 text-sm text-accent-800">
          Aucune liste de diffusion n&apos;existe. Créez-en une (Prisma Studio,{" "}
          <code className="font-mono text-xs">npm run db:studio</code>) avant de rédiger une
          campagne.
        </p>
      ) : (
        <div className="mt-8">
          <CampaignForm action={createCampaign} lists={lists} submitLabel="Enregistrer en brouillon" />
        </div>
      )}

      <p className="mt-8 text-sm">
        <Link
          href="/backoffice/newsletter/campaigns"
          className="font-semibold text-primary-700 underline transition-colors hover:text-primary-900"
        >
          Retour aux campagnes
        </Link>
      </p>
    </div>
  );
}
