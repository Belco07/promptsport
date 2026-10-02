import type { UserRole } from "@/lib/roles";

declare module "next-auth" {
  interface User {
    role?: UserRole;
    isPremium?: boolean;
  }

  interface Session {
    user: {
      id: string;
      role: UserRole;
      /// Statut premium exposé directement (WP7e) : plus besoin d'interroger la
      /// base côté client pour afficher le badge.
      isPremium: boolean;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: UserRole;
    isPremium?: boolean;
    /// Horodatage de la dernière vérification en base (rafraîchissement).
    premiumCheckedAt?: number;
  }
}
