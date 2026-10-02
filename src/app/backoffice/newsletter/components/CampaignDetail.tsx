import Link from "next/link";

import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { formatDate } from "@/lib/formatDate";
import {
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_TONES,
  SEND_STATUS_LABELS,
  SEND_STATUS_TONES,
  openRate,
  type CampaignStatus,
  type SendStatus,
} from "@/lib/newsletter";

/**
 * Panneau de détail d'une campagne (WP11a), rendu par la page quand l'URL
 * contient `?campagne=<id>`.
 *
 * Le corps HTML est affiché **en source échappée**, jamais injecté dans la page :
 * le rendu d'un contenu de campagne viendra avec l'aperçu du WP11d, où il sera
 * assaini. Aucun envoi n'a lieu ici.
 */

export type CampaignDetailData = {
  id: string;
  subject: string;
  previewText: string | null;
  contentHtml: string;
  contentText: string | null;
  status: CampaignStatus;
  scheduledAt: Date | null;
  sentAt: Date | null;
  recipientCount: number;
  deliveredCount: number;
  openCount: number;
  clickCount: number;
  bounceCount: number;
  createdAt: Date;
  updatedAt: Date;
  list: { id: string; name: string; slug: string; active: boolean };
  createdBy: { id: string; name: string; email: string };
  sends: {
    id: string;
    status: SendStatus;
    sentAt: Date | null;
    errorMessage: string | null;
    subscriber: { email: string };
  }[];
  /** Nombre total d'envois, au-delà de ceux affichés. */
  sendCount: number;
};

/** Compteur du bloc statistiques. */
function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="text-lg font-bold tabular-nums text-neutral-900">{value}</dd>
      {hint ? <p className="text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
}

export function CampaignDetail({
  campaign,
  closeHref,
  htmlPreviewLength = 1200,
}: {
  campaign: CampaignDetailData;
  closeHref: string;
  /** Longueur maximale de la source HTML affichée. */
  htmlPreviewLength?: number;
}) {
  const truncated = campaign.contentHtml.length > htmlPreviewLength;
  const htmlPreview = truncated
    ? `${campaign.contentHtml.slice(0, htmlPreviewLength)}…`
    : campaign.contentHtml;

  return (
    <Card as="section" className="mt-6 border-primary-200">
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-primary-900">{campaign.subject}</h2>
            <p className="text-sm text-neutral-600">
              Liste {campaign.list.name}
              {campaign.list.active ? "" : " (inactive)"} · créée par {campaign.createdBy.name}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="status" tone={CAMPAIGN_STATUS_TONES[campaign.status]}>
              {CAMPAIGN_STATUS_LABELS[campaign.status]}
            </Badge>
            <Link
              href={closeHref}
              className="text-sm font-semibold text-neutral-600 underline transition-colors hover:text-neutral-900"
            >
              Fermer
            </Link>
          </div>
        </div>

        {campaign.previewText ? (
          <p className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm italic text-neutral-700">
            Pré-en-tête : {campaign.previewText}
          </p>
        ) : null}

        <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Metric
            label="Destinataires"
            value={String(campaign.recipientCount)}
            hint={`${campaign.sendCount} envoi${campaign.sendCount > 1 ? "s" : ""} préparé${campaign.sendCount > 1 ? "s" : ""}`}
          />
          <Metric label="Délivrés" value={String(campaign.deliveredCount)} />
          <Metric
            label="Ouvertures"
            value={String(campaign.openCount)}
            hint={`taux ${openRate(campaign)}`}
          />
          <Metric label="Clics" value={String(campaign.clickCount)} />
          <Metric label="Rejets" value={String(campaign.bounceCount)} />
        </dl>

        <dl className="mt-5 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Créée le</dt>
            <dd className="text-neutral-800">{formatDate(campaign.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Envoi prévu</dt>
            <dd className="text-neutral-800">
              {campaign.scheduledAt ? formatDate(campaign.scheduledAt) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Envoyée le</dt>
            <dd className="text-neutral-800">
              {campaign.sentAt ? formatDate(campaign.sentAt) : "—"}
            </dd>
          </div>
        </dl>

        <div className="mt-5">
          <h3 className="text-sm font-bold text-neutral-800">
            Source HTML {truncated ? `(tronquée à ${htmlPreviewLength} caractères)` : ""}
          </h3>
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
            {htmlPreview}
          </pre>
          <p className="mt-1 text-xs text-neutral-500">
            Affichée en texte échappé : le rendu et l&apos;aperçu HTML arrivent avec le WP11d.
            {campaign.contentText ? " Une version texte brut est également enregistrée." : ""}
          </p>
        </div>

        <div className="mt-5">
          <h3 className="text-sm font-bold text-neutral-800">
            Envois ({campaign.sendCount})
          </h3>
          {campaign.sends.length === 0 ? (
            <p className="mt-1 text-sm text-neutral-600">
              Aucun envoi individuel : rien n&apos;a encore été expédié (WP11b).
            </p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {campaign.sends.map((send) => (
                <li key={send.id} className="flex flex-wrap items-center gap-3">
                  <Badge variant="status" tone={SEND_STATUS_TONES[send.status]}>
                    {SEND_STATUS_LABELS[send.status]}
                  </Badge>
                  <span className="text-neutral-800">{send.subscriber.email}</span>
                  <span className="text-xs text-neutral-500">
                    {send.sentAt ? formatDate(send.sentAt) : "non envoyé"}
                  </span>
                  {send.errorMessage ? (
                    <span className="text-xs text-danger-700">{send.errorMessage}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {campaign.sendCount > campaign.sends.length ? (
            <p className="mt-1 text-xs text-neutral-500">
              {campaign.sendCount - campaign.sends.length} autre
              {campaign.sendCount - campaign.sends.length > 1 ? "s" : ""} envoi
              {campaign.sendCount - campaign.sends.length > 1 ? "s" : ""} non affiché
              {campaign.sendCount - campaign.sends.length > 1 ? "s" : ""}.
            </p>
          ) : null}
        </div>

        <p className="mt-5 text-xs text-neutral-500">
          Dernière modification : {formatDate(campaign.updatedAt)}.
        </p>
      </CardBody>
    </Card>
  );
}
