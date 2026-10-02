import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { TestEmailButton } from "@/app/backoffice/newsletter/campaigns/components/TestEmailButton";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { auth } from "@/lib/auth";
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONES } from "@/lib/newsletter";
import { renderCampaignEmail } from "@/lib/email-templates";
import { countCampaignRecipients } from "@/lib/newsletter-send";
import { prisma } from "@/lib/prisma";

/**
 * Prévisualisation d'une campagne (WP11d).
 *
 * Le HTML est rendu **exactement** comme à l'envoi (même gabarit, mêmes liens),
 * puis affiché dans une `iframe` en `sandbox` : le contenu d'une campagne est du
 * HTML écrit par un administrateur, il ne doit pas s'exécuter dans l'application
 * — ni script, ni navigation, ni accès aux cookies.
 *
 * Les liens de désabonnement et le pixel de suivi pointent volontairement vers
 * des jetons factices (`apercu`) : prévisualiser ne doit ni compter une
 * ouverture, ni permettre de désabonner quelqu'un.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Prévisualiser une campagne", robots: { index: false } };

const MESSAGES: Record<string, string> = {
  "test-envoye": "E-mail de test envoyé",
  "test-echec": "L'envoi du test a échoué (voir les journaux du serveur)",
  "email-invalide": "Cette adresse e-mail ne semble pas valide",
};

export default async function PreviewCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ message?: string; adresse?: string }>;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/studio");
  }

  const [{ id }, query] = await Promise.all([params, searchParams]);
  const campaign = await prisma.newsletterCampaign.findUnique({
    where: { id },
    select: {
      id: true,
      subject: true,
      previewText: true,
      contentHtml: true,
      contentText: true,
      status: true,
      listId: true,
      list: { select: { name: true } },
    },
  });

  if (!campaign) {
    notFound();
  }

  const recipients = await countCampaignRecipients(campaign.listId);

  // Rendu identique à l'envoi, avec un destinataire fictif.
  const rendered = renderCampaignEmail(
    {
      subject: campaign.subject,
      previewText: campaign.previewText,
      contentHtml: campaign.contentHtml,
      contentText: campaign.contentText,
    },
    { email: "apercu@exemple.fr", name: "Aperçu" },
    {
      unsubscribeUrl: "/newsletter/preferences/apercu",
      trackingPixelUrl: "/api/newsletter/track-open/apercu",
    },
  );

  const notice = query.message ? (MESSAGES[query.message] ?? null) : null;

  return (
    <div className="px-8 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary-900">Prévisualisation</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
            <Badge variant="status" tone={CAMPAIGN_STATUS_TONES[campaign.status]}>
              {CAMPAIGN_STATUS_LABELS[campaign.status]}
            </Badge>
            <span>{campaign.subject}</span>
            <span>· liste {campaign.list.name}</span>
            <span>
              · {recipients} destinataire{recipients > 1 ? "s" : ""} confirmé
              {recipients > 1 ? "s" : ""}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <TestEmailButton campaignId={campaign.id} />
          <Link
            href={`/backoffice/newsletter/campaigns/${campaign.id}/edit`}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 transition-colors hover:border-primary-300 hover:bg-primary-50"
          >
            Modifier
          </Link>
          <Link
            href={`/backoffice/newsletter/campaigns/${campaign.id}`}
            className="text-sm font-semibold text-neutral-600 underline"
          >
            Retour à la campagne
          </Link>
        </div>
      </div>

      {notice ? (
        <p
          role="status"
          className={`mt-6 rounded-lg border px-4 py-3 text-sm font-medium ${
            query.message === "test-envoye"
              ? "border-success-200 bg-success-50 text-success-800"
              : "border-danger-200 bg-danger-50 text-danger-700"
          }`}
        >
          {notice}
          {query.adresse ? ` à ${query.adresse}.` : "."}
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardBody className="p-0">
            <p className="border-b border-neutral-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Rendu de l&apos;e-mail (iframe isolée)
            </p>
            {/* sandbox vide : aucun script, aucune navigation, aucun cookie. */}
            <iframe
              title={`Prévisualisation de « ${campaign.subject} »`}
              srcDoc={rendered.html}
              sandbox=""
              referrerPolicy="no-referrer"
              className="h-[640px] w-full rounded-b-xl border-0 bg-neutral-100"
            />
          </CardBody>
        </Card>

        <aside className="space-y-4 text-sm">
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-bold text-neutral-800">Version texte</h2>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
              {rendered.text}
            </pre>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-neutral-600">
            <h2 className="text-sm font-bold text-neutral-800">Avant d&apos;envoyer</h2>
            <ul className="mt-2 space-y-1.5">
              <li>· le lien de désabonnement est ajouté automatiquement ;</li>
              <li>· les images distantes peuvent être bloquées par les clients ;</li>
              <li>· un test vers votre propre adresse est recommandé ;</li>
              <li>· l&apos;envoi réel est irréversible.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
