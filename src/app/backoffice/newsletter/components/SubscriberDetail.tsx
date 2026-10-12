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
            <p className="text-sm text-muted-foreground">{subscriber.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="status" tone={SUBSCRIBER_STATUS_TONES[subscriber.status]}>
              {SUBSCRIBER_STATUS_LABELS[subscriber.status]}
            </Badge>
            <Link
              href={closeHref}
              className="text-sm font-semibold text-muted-foreground underline transition-colors hover:text-foreground"
            >
              Fermer
            </Link>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Origine</dt>
            <dd className="text-foreground">{subscriberSourceLabel(subscriber.source)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Inscrit le</dt>
            <dd className="text-foreground">{formatDate(subscriber.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Confirmé le</dt>
            <dd className="text-foreground">
              {subscriber.confirmedAt ? formatDate(subscriber.confirmedAt) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Désabonné le</dt>
            <dd className="text-foreground">
              {subscriber.unsubscribedAt ? formatDate(subscriber.unsubscribedAt) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Compte lié</dt>
            <dd className="text-foreground">
              {subscriber.user ? `${subscriber.user.name} (${subscriber.user.email})` : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Jeton de confirmation
            </dt>
            <dd className="break-all font-mono text-xs text-foreground">
              {subscriber.confirmationToken ?? "—"}
            </dd>
          </div>
        </dl>

        <div className="mt-5">
          <h3 className="text-sm font-bold text-foreground">Listes</h3>
          {subscriber.lists.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
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
          <h3 className="text-sm font-bold text-foreground">
            Derniers envois ({subscriber.sends.length})
          </h3>
          {subscriber.sends.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Aucun envoi : les campagnes n&apos;ont pas encore été expédiées (WP11b).
            </p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {subscriber.sends.map((send) => (
                <li key={send.id} className="flex flex-wrap items-center gap-3">
                  <Badge variant="status" tone={SEND_STATUS_TONES[send.status]}>
                    {SEND_STATUS_LABELS[send.status]}
                  </Badge>
                  <span className="text-foreground">{send.campaignSubject}</span>
                  <span className="text-xs text-muted-foreground">
                    {send.sentAt ? formatDate(send.sentAt) : "non envoyé"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="mt-5 text-xs text-muted-foreground">
          Dernière modification : {formatDate(subscriber.updatedAt)}.
        </p>
      </CardBody>
    </Card>
  );
}
