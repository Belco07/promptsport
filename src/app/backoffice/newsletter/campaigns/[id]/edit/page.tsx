import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { updateCampaign } from "@/app/backoffice/newsletter/campaigns/actions";
import { CampaignForm } from "@/app/backoffice/newsletter/campaigns/components/CampaignForm";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Édition d'une campagne (WP11d).
 *
 * Seules les campagnes **DRAFT** et **SCHEDULED** sont modifiables : une
 * campagne en cours d'envoi ou déjà partie ne doit pas pouvoir changer sous les
 * pieds des destinataires. Dans ce cas, on redirige vers le détail avec un
 * message plutôt que d'afficher un formulaire inerte.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Modifier une campagne", robots: { index: false } };

/** Convertit une date en valeur d'`<input type="datetime-local">` (heure locale). */
function toLocalInputValue(date: Date | null): string {
  if (!date) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/studio");
  }

  const { id } = await params;
  const [campaign, lists] = await Promise.all([
    prisma.newsletterCampaign.findUnique({ where: { id } }),
    prisma.newsletterList.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, active: true },
    }),
  ]);

  if (!campaign) {
    notFound();
  }

  if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") {
    redirect(`/backoffice/newsletter/campaigns/${id}?message=non-modifiable`);
  }

  return (
    <div className="px-8 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-primary-900">Modifier la campagne</h1>
      <p className="mt-2 text-sm text-neutral-600">
        {campaign.subject} · statut {campaign.status === "DRAFT" ? "brouillon" : "planifiée"}
      </p>

      <div className="mt-8">
        <CampaignForm
          action={updateCampaign.bind(null, campaign.id)}
          lists={lists}
          submitLabel="Enregistrer les modifications"
          campaignId={campaign.id}
          defaultValues={{
            subject: campaign.subject,
            previewText: campaign.previewText ?? "",
            listId: campaign.listId,
            contentHtml: campaign.contentHtml,
            scheduledAt: toLocalInputValue(campaign.scheduledAt),
          }}
        />
      </div>

      <p className="mt-8 text-sm">
        <Link
          href={`/backoffice/newsletter/campaigns/${campaign.id}`}
          className="font-semibold text-primary-700 underline transition-colors hover:text-primary-900"
        >
          Voir la campagne
        </Link>
      </p>
    </div>
  );
}
