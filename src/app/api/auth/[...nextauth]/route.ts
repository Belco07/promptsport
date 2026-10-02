import { handlers } from "@/lib/auth";

/**
 * Route handler Auth.js : /api/auth/*
 * Expose la connexion, la déconnexion, la session et le callback CSRF.
 */
export const { GET, POST } = handlers;
