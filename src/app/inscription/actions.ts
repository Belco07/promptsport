"use server";
import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rate-limit";
import { authenticate } from "../login/actions";

export async function register(_state: string | undefined, form: FormData): Promise<string | undefined> {
  const ip = clientIpFromHeaders(await headers());
  if (!consumeRateLimit(`register:${ip}`, { max: 5, windowMs: 3600000 }).allowed) return "Trop de tentatives. Réessayez dans une heure.";
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (name.length < 2 || name.length > 100) return "Le prénom doit comporter entre 2 et 100 caractères.";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Saisissez une adresse e-mail valide.";
  if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) return "Utilisez au moins 12 caractères et au maximum 72 octets pour le mot de passe.";
  if (form.get("terms") !== "on") return "Veuillez confirmer la lecture de la politique de confidentialité.";
  try {
    await prisma.author.create({ data: { name, email, passwordHash: await bcrypt.hash(password, 12), role: "READER", welcomeCompleted: false } });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") return "Inscription impossible avec cette adresse. Si vous avez déjà un compte, connectez-vous.";
    return "L’inscription est momentanément indisponible. Réessayez.";
  }
  return authenticate(undefined, form);
}
