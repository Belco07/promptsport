import Link from "next/link";

import { deleteList, toggleList } from "@/app/backoffice/newsletter/actions";
import { Badge } from "@/components/ui/Badge";

/**
 * Onglet « Listes » de /backoffice/newsletter.
 *
 * Tableau : nom, identifiant d'URL, abonnés, campagnes, état, actions
 * (activer/désactiver, modifier, supprimer). Le formulaire de création et
 * d'édition vit dans `ListForm`, un composant client qui affiche le compte rendu
 * de la Server Action.
 *
 * C'est le complément qui manquait : les listes n'étaient créables que dans
 * Prisma Studio, ce qui rendait impossible l'ouverture d'une nouvelle liste
 * thématique ou la composition d'une relance.
 */

/** Une ligne du tableau des listes. */
export type NewsletterListRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  active: boolean;
  subscriberCount: number;
  confirmedCount: number;
  campaignCount: number;
};

/** Bloc de création, rendu au-dessus du tableau. */
export function ListCreateHint() {
  return (
    <p className="text-sm text-neutral-600">
      Une liste regroupe des abonnés. Seuls les abonnés <strong>confirmés</strong> d&apos;une liste
      reçoivent ses campagnes ; une liste inactive est ignorée à l&apos;envoi et disparaît du
      formulaire public.
    </p>
  );
}

export function ListsTab({
  rows,
  detailId,
  createForm,
  detailForm,
}: {
  rows: NewsletterListRow[];
  detailId?: string;
  /** Formulaire de création, fourni par la page (Server Actions liées). */
  createForm: React.ReactNode;
  /** Formulaire d'édition de la liste ouverte, s'il y en a une. */
  detailForm?: React.ReactNode;
}) {
  return (
    <div className="mt-6 space-y-6">
      <section aria-labelledby="nouvelle-liste">
        <h2 id="nouvelle-liste" className="text-sm font-bold text-neutral-800">
          Créer une liste de diffusion
        </h2>
        <div className="mt-3 rounded-xl border border-neutral-200 bg-white p-5">{createForm}</div>
      </section>

      {detailForm ? (
        <section aria-labelledby="modifier-liste" className="rounded-xl border border-primary-200 bg-white p-5">
          <h2 id="modifier-liste" className="text-sm font-bold text-neutral-800">
            Modifier la liste
          </h2>
          <div className="mt-3">{detailForm}</div>
        </section>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Listes de diffusion</caption>
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th scope="col" className="px-3 py-3 font-semibold">
                Liste
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Identifiant
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Abonnés
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Campagnes
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                État
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-neutral-500">
                  Aucune liste de diffusion. Créez-en une ci-dessus pour pouvoir inscrire des
                  abonnés et envoyer une campagne.
                </td>
              </tr>
            ) : (
              rows.map((list) => (
                <tr key={list.id} className="align-top hover:bg-neutral-50">
                  <td className="px-3 py-3">
                    <span className="font-medium text-neutral-900">{list.name}</span>
                    {list.description ? (
                      <span className="block max-w-md text-xs text-neutral-500">
                        {list.description}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-neutral-500">{list.slug}</td>
                  <td className="px-3 py-3 tabular-nums text-neutral-700">
                    {list.subscriberCount}
                    <span className="block text-xs text-neutral-500">
                      dont {list.confirmedCount} confirmé{list.confirmedCount > 1 ? "s" : ""}
                    </span>
                  </td>
                  <td className="px-3 py-3 tabular-nums text-neutral-700">{list.campaignCount}</td>
                  <td className="px-3 py-3">
                    {list.active ? (
                      <Badge variant="status" tone="success">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="status" tone="neutral">
                        Inactive
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Link
                        href={`/backoffice/newsletter?tab=lists&liste=${list.id}`}
                        aria-current={detailId === list.id ? "true" : undefined}
                        className="text-sm font-semibold text-primary-700 underline"
                      >
                        Modifier
                      </Link>
                      <form action={toggleList.bind(null, list.id)}>
                        <button type="submit" className="text-sm font-semibold text-neutral-600 underline">
                          {list.active ? "Désactiver" : "Activer"}
                        </button>
                      </form>
                      <form action={deleteList.bind(null, list.id)}>
                        <button
                          type="submit"
                          className="text-sm font-semibold text-danger-700 underline"
                          title={
                            list.campaignCount > 0
                              ? "Une liste rattachée à une campagne ne peut pas être supprimée"
                              : "Supprimer la liste"
                          }
                        >
                          Supprimer
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
