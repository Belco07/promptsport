"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { reportComment } from "@/app/article/[slug]/actions";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { REPORT_REASONS, REPORT_REASON_LABELS, type ReportReason } from "@/lib/engagement";

/**
 * Signalement public d'un commentaire (WP10b).
 *
 * Composant client : la modale s'ouvre et se ferme localement, sans dépendance
 * externe. L'envoi passe par la Server Action, qui vérifie la session, le
 * bannissement, le motif et l'unicité du signalement ; le commentaire passe
 * alors en FLAGGED et disparaît de la liste après rafraîchissement.
 */
export function ReportModal({
  commentId,
  canReport,
  disabledReason = "Connectez-vous pour signaler",
}: {
  commentId: string;
  canReport: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("SPAM");
  const [details, setDetails] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setFeedback(null);
    startTransition(async () => {
      const result = await reportComment(commentId, reason, details);
      if (result.ok) {
        setFeedback({
          type: "success",
          text: "Merci, votre signalement a été transmis à la modération.",
        });
        setDetails("");
        // Le commentaire signalé n'est plus public : la liste est rechargée.
        router.refresh();
      } else {
        setFeedback({ type: "error", text: result.error });
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!canReport}
        title={canReport ? "Signaler ce commentaire" : disabledReason}
        className="text-xs font-medium text-muted-foreground underline transition-colors hover:text-status-error-foreground disabled:cursor-not-allowed disabled:opacity-60"
      >
        Signaler
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`titre-signalement-${commentId}`}
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <h2 id={`titre-signalement-${commentId}`} className="text-lg font-bold text-foreground">
              Signaler ce commentaire
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Le commentaire est masqué le temps qu&apos;un modérateur l&apos;examine.
            </p>

            {canReport ? (
              <form
                className="mt-5 flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
              >
                <Select
                  name="reason"
                  label="Motif"
                  value={reason}
                  onChange={(event) => setReason(event.target.value as ReportReason)}
                  options={REPORT_REASONS.map((value) => ({
                    value,
                    label: REPORT_REASON_LABELS[value],
                  }))}
                />

                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`details-${commentId}`} className="text-sm font-medium text-foreground">
                    Précisions (facultatif)
                  </label>
                  <textarea
                    id={`details-${commentId}`}
                    name="details"
                    rows={3}
                    maxLength={500}
                    value={details}
                    onChange={(event) => setDetails(event.target.value)}
                    placeholder="Décrivez le problème en quelques mots."
                    className="resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                  />
                </div>

                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="text-sm font-semibold text-foreground underline"
                  >
                    Annuler
                  </button>
                  <Button type="submit" variant="danger" disabled={isPending}>
                    {isPending ? "Envoi…" : "Envoyer le signalement"}
                  </Button>
                </div>
              </form>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                <a href="/login" className="font-semibold text-editorial-link underline">
                  Connectez-vous
                </a>{" "}
                pour signaler un commentaire.
              </p>
            )}

            {feedback ? (
              <p
                role={feedback.type === "success" ? "status" : "alert"}
                className={`mt-4 rounded-lg border px-3 py-2 text-sm font-medium ${
                  feedback.type === "success"
                    ? "border-status-success-border bg-status-success text-status-success-foreground"
                    : "border-status-error-border bg-status-error text-status-error-foreground"
                }`}
              >
                {feedback.text}
              </p>
            ) : null}

            {feedback?.type === "success" ? (
              <div className="mt-4 text-right">
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                  Fermer
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
