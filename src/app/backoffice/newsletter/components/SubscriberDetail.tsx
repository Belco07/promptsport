import Link from "next/link";

import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { formatDate } from "@/lib/formatDate";
import {
  SEND_STATUS_LABELS,
  SEND_STATUS_TONES,
  SUBSCRIBER_STATUS_LABELS,
  SUBSCRIBER_STATUS_TONES,
  subscriberSourceLabel,
  type SendStatus,
  type SubscriberStatus,
} from "@/lib/newsletter";

/**
 * Panneau de détail d'un abonné (WP11a), rendu par la page quand l'URL contient
 * `?abonne=<id>`.
 *
 * Choix de conception : pas de page dédiée — le périmètre d'écriture du WP11a
 * s'arrête à `/backoffice/newsletter`. Le panneau se ferme par un simple lien
 * (« Fermer »), sans JavaScript, sur le modèle du formulaire de bannissement du
 * WP10c.
 */

export type SubscriberDetailData = {
  id: string;
  email: string;
  name: string | null;
  status: SubscriberStatus;
  source: string | null;
  confirmationToken: string | null;
  confirmedAt: Date | null;
  unsubscribedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; name: string; email: string } | null;
  lists: { id: string; name: string; slug: string; active: boolean }[];
  sends: {
    id: string;
    status: SendStatus;
    sentAt: Date | null;
    campaignSubject: string;
  }[];
};

export function SubscriberDetail({
  subscriber,
  closeHref,
}: {
  subscriber: SubscriberDetailData;
  closeHref: string;
}) {
  return (
    <Card as="section" className="mt-6 border-primary-200">
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-primary-900">
              {subscriber.name ?? subscriber.email}
            </h2>
            <p className="text-sm text-neutral-600">{subscriber.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="status" tone={SUBSCRIBER_STATUS_TONES[subscriber.status]}>
              {SUBSCRIBER_STATUS_LABELS[subscriber.status]}
            </Badge>
            <Link
              href={closeHref}
              className="text-sm font-semibold text-neutral-600 underline transition-colors hover:text-neutral-900"
            >
              Fermer
            </Link>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Origine</dt>
            <dd className="text-neutral-800">{subscriberSourceLabel(subscriber.source)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Inscrit le</dt>
            <dd className="text-neutral-800">{formatDate(subscriber.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Confirmé le</dt>
            <dd className="text-neutral-800">
              {subscriber.confirmedAt ? formatDate(subscriber.confirmedAt) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Désabonné le</dt>
            <dd className="text-neutral-800">
              {subscriber.unsubscribedAt ? formatDate(subscriber.unsubscribedAt) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Compte lié</dt>
            <dd className="text-neutral-800">
              {subscriber.user ? `${subscriber.user.name} (${subscriber.user.email})` : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">
              Jeton de confirmation
            </dt>
            <dd className="break-all font-mono text-xs text-neutral-800">
              {subscriber.confirmationToken ?? "—"}
            </dd>
          </div>
        </dl>

        <div className="mt-5">
          <h3 className="text-sm font-bold text-neutral-800">Listes</h3>
          {subscriber.lists.length === 0 ? (
            <p className="mt-1 text-sm text-neutral-600">
              Cet abonné n&apos;est inscrit à aucune liste.
            </p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {subscriber.lists.map((list) => (
                <li key={list.id}>
                  <Badge variant="category" tone={list.active ? "primary" : "neutral"}>
                    {list.name}
                    {list.active ? "" : " (inactive)"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-5">
          <h3 className="text-sm font-bold text-neutral-800">
            Derniers envois ({subscriber.sends.length})
          </h3>
          {subscriber.sends.length === 0 ? (
            <p className="mt-1 text-sm text-neutral-600">
              Aucun envoi : les campagnes n&apos;ont pas encore été expédiées (WP11b).
            </p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {subscriber.sends.map((send) => (
                <li key={send.id} className="flex flex-wrap items-center gap-3">
                  <Badge variant="status" tone={SEND_STATUS_TONES[send.status]}>
                    {SEND_STATUS_LABELS[send.status]}
                  </Badge>
                  <span className="text-neutral-800">{send.campaignSubject}</span>
                  <span className="text-xs text-neutral-500">
                    {send.sentAt ? formatDate(send.sentAt) : "non envoyé"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="mt-5 text-xs text-neutral-500">
          Dernière modification : {formatDate(subscriber.updatedAt)}.
        </p>
      </CardBody>
    </Card>
  );
}
