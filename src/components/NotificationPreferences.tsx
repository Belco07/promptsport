"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { updateNotificationPreferences } from "@/app/mon-compte/preferences/actions";
import { Button } from "@/components/ui/Button";

/**
 * Formulaire des préférences de notification (WP11e).
 *
 * Composant client par nécessité : l'interrupteur global désactive visuellement
 * les cases de types (elles restent affichées, mais deviennent inactives), ce qui
 * évite de laisser croire qu'un réglage fin s'applique encore.
 *
 * Les cases non cochées sont bien envoyées au serveur : un formulaire omet une
 * case décochée, et c'est **l'absence** qui signifie « type désactivé ». Les
 * cases désactivées par l'interrupteur global sont accompagnées d'un champ caché
 * pour que leur valeur ne soit pas perdue à l'enregistrement.
 */

export type NotificationPreferenceOption = {
  type: string;
  label: string;
  hint: string;
};

export function NotificationPreferences({
  options,
  enabled,
  disabledTypes,
}: {
  options: NotificationPreferenceOption[];
  enabled: boolean;
  disabledTypes: string[];
}) {
  const [errorMessage, formAction, isPending] = useActionState(
    updateNotificationPreferences,
    undefined,
  );
  const [globalEnabled, setGlobalEnabled] = useState(enabled);

  return (
    <form action={formAction} className="space-y-6">
      <div className="rounded-lg border border-border bg-muted p-4">
        <label
          htmlFor="emailNotificationsEnabled"
          className="flex items-center gap-2.5 text-sm font-semibold text-foreground"
        >
          <input
            id="emailNotificationsEnabled"
            name="emailNotificationsEnabled"
            type="checkbox"
            defaultChecked={enabled}
            onChange={(event) => setGlobalEnabled(event.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Recevoir les notifications par email
        </label>
        <p className="mt-1 pl-6 text-xs text-muted-foreground">
          Décochez cette case pour ne plus recevoir aucun e-mail de notification. Vos notifications
          restent consultables dans{" "}
          <Link href="/mon-compte/notifications" className="font-semibold text-editorial-link underline">
            votre espace
          </Link>
          .
        </p>
      </div>

      <fieldset disabled={!globalEnabled} className={globalEnabled ? "" : "opacity-60"}>
        <legend className="text-sm font-semibold text-foreground">
          Types de notifications à recevoir par email
        </legend>
        <p className="mt-1 text-xs text-muted-foreground">
          Les réactions à vos commentaires et les autres alertes restent uniquement dans
          l&apos;application.
        </p>

        <ul className="mt-3 space-y-3">
          {options.map((option) => {
            const isDisabled = disabledTypes.includes(option.type);
            return (
              <li key={option.type} className="rounded-lg border border-border bg-card p-4">
                <label htmlFor={`type-${option.type}`} className="flex items-start gap-2.5 text-sm">
                  <input
                    id={`type-${option.type}`}
                    name="types"
                    type="checkbox"
                    value={option.type}
                    defaultChecked={!isDisabled}
                    className="mt-0.5 h-4 w-4 rounded border-border"
                  />
                  <span>
                    <span className="font-medium text-foreground">{option.label}</span>
                    <span className="block text-xs text-muted-foreground">{option.hint}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {/* Interrupteur global décoché : un `fieldset disabled` empêche l'envoi de
          TOUS ses contrôles, y compris les champs cachés qu'il contiendrait. Ces
          champs, placés à l'extérieur, conservent donc le réglage fin par type. */}
      {!globalEnabled
        ? options
            .filter((option) => !disabledTypes.includes(option.type))
            .map((option) => (
              <input key={option.type} type="hidden" name="types" value={option.type} />
            ))
        : null}

      {errorMessage ? (
        <p
          role="alert"
          className="rounded-lg border border-status-error-border bg-status-error px-4 py-3 text-sm font-medium text-status-error-foreground"
        >
          {errorMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Enregistrement…" : "Enregistrer mes préférences"}
        </Button>
        <Link
          href="/mon-compte"
          className="text-sm font-semibold text-muted-foreground underline transition-colors hover:text-foreground"
        >
          Retour à mon compte
        </Link>
      </div>
    </form>
  );
}
