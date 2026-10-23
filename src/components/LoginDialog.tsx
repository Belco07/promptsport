"use client";

import { useRef, type ReactNode } from "react";

import { X } from "@/components/icons";
import { LoginCard, type OAuthProviders } from "@/components/LoginCard";

/**
 * Fenêtre de connexion ouverte depuis l'icône compte de l'en-tête, comme la
 * référence « Digital Haven » : la carte de connexion s'affiche par-dessus la
 * page, sur un voile sombre. Échap, la croix ou un clic sur le voile la
 * referment. Élément <dialog> natif : focus piégé et rendu au bouton.
 */
export function LoginDialog({ providers, trigger }: { providers: OAuthProviders; trigger: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label="Se connecter"
        title="Se connecter"
        onClick={() => dialog.current?.showModal()}
        className="!min-h-11 inline-flex items-center px-2 py-1.5 text-foreground hover:text-editorial-link"
      >
        {trigger}
      </button>
      <dialog
        ref={dialog}
        aria-label="Connexion"
        onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }}
        className="m-auto w-[calc(100%-40px)] max-w-[400px] overflow-visible bg-transparent p-0 backdrop:bg-black/55"
      >
        <div className="relative">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label="Fermer la fenêtre de connexion"
            className="absolute -top-12 right-0 flex h-[42px] w-[42px] items-center justify-center !rounded-full bg-card text-foreground shadow-md hover:text-editorial-link"
          >
            <X aria-hidden="true" size={20} />
          </button>
          <LoginCard providers={providers} as="h2" />
        </div>
      </dialog>
    </>
  );
}
