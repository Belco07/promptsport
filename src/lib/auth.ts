import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { prisma } from "@/lib/prisma";
import { isUserRole } from "@/lib/roles";
import { authConfig } from "./auth.config";

/**
 * Configuration Auth.js (NextAuth v5) — runtime Node.
 *
 * Stratégie : Credentials (email + mot de passe), session JWT.
 *
 * Note sur l'adaptateur Prisma : avec une stratégie Credentials, la session est
 * un JWT signé et aucune table de session n'est utilisée. L'adaptateur est
 * branché conformément au brief, mais notre schéma Prisma ne définit pas les
 * modèles User/Account/Session/VerificationToken/Authenticator (le brief WP2b
 * interdit de modifier le schéma au-delà de Author) : il est donc casté, car ses
 * méthodes ne seront jamais appelées dans ce flux.
 */
/**
 * Durée de validité du statut premium mis en cache dans le JWT.
 *
 * Le rôle et l'abonnement vivent en base : sans rafraîchissement, un paiement
 * ne serait reflété qu'à la reconnexion. On revérifie donc au plus une fois par
 * minute (court, pour que le badge Premium apparaisse sans reconnexion, tout en
 * évitant une requête à chaque lecture de session).
 */
const PREMIUM_REFRESH_MS = 60 * 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  ...authConfig,
  adapter: PrismaAdapter(
    prisma as unknown as Parameters<typeof PrismaAdapter>[0],
  ),
  session: {
    strategy: "jwt",
  },
  /**
   * Auth.js v5 refuse toute requête dont l'hôte n'est pas déclaré de confiance
   * dès que NODE_ENV vaut production (erreur « UntrustedHost ») : sans cette
   * option, /api/auth/* renvoie 500 en production et la connexion est
   * impossible, alors que tout fonctionne en développement, où localhost est
   * toléré. L'hôte est ici celui du déploiement (localhost ou domaine public) et
   * la valeur de AUTH_URL, lorsqu'elle est fournie, reste prioritaire.
   */
  trustHost: true,
  providers: [
    Credentials({
      name: "Email et mot de passe",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === "string"
            ? credentials.email.trim().toLowerCase()
            : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";

        if (!email || !password) {
          return null;
        }

        const author = await prisma.author.findUnique({ where: { email } });
        if (!author) {
          return null;
        }

        const passwordMatches = await bcrypt.compare(
          password,
          author.passwordHash,
        );
        if (!passwordMatches) {
          return null;
        }

        return {
          id: author.id,
          name: author.name,
          email: author.email,
          role: author.role,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        // Expose le rôle dans le JWT pour que le middleware puisse le lire.
        token.role = isUserRole(user.role) ? user.role : "JOURNALIST";
      }

      // Rôle et abonnement vivent en base : on les relit à la connexion, sur
      // demande explicite (`update`) et dès que le cache dépasse sa durée de
      // validité — un abonnement souscrit ou résilié est ainsi reflété sans
      // reconnexion.
      const checkedAt = typeof token.premiumCheckedAt === "number" ? token.premiumCheckedAt : 0;
      const isStale = Date.now() - checkedAt > PREMIUM_REFRESH_MS;

      if (typeof token.id === "string" && (user || trigger === "update" || isStale)) {
        const author = await prisma.author.findUnique({
          where: { id: token.id },
          select: { role: true, isPremium: true },
        });
        if (author) {
          token.role = author.role;
          token.isPremium = author.isPremium;
          token.premiumCheckedAt = Date.now();
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = typeof token.id === "string" ? token.id : token.sub ?? "";
        session.user.role = isUserRole(token.role) ? token.role : "JOURNALIST";
        session.user.isPremium = token.isPremium === true;
      }
      return session;
    },
  },
});
