import type { NextAuthConfig } from "next-auth";

/**
 * Configuration partagée entre le runtime Node (src/lib/auth.ts) et le
 * middleware Edge (middleware.ts).
 *
 * Ce fichier ne doit rester dépendant QUE de choses compatibles Edge :
 * bcryptjs et Prisma n'y ont pas leur place. Le middleware n'a de toute façon
 * pas besoin du provider : il se contente de lire le JWT signé, présent ou non.
 */
export const authConfig = {
  pages: {
    /**
     * La page de connexion vit HORS des préfixes protégés /studio et /backoffice :
     * le middleware ne couvre que ces préfixes, donc aucune redirection ne peut
     * boucler sur la page de connexion elle-même.
     */
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    /** Retourner false redirige vers pages.signIn (cf. middleware.ts). */
    authorized({ auth }) {
      return Boolean(auth?.user);
    },
  },
} satisfies NextAuthConfig;
