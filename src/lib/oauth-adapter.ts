import type { Adapter, AdapterUser } from "next-auth/adapters";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

// Author remains the single identity for readers, subscriptions and editorial users.
function user(row: { id: string; email: string; name: string; role: AdapterUser["role"] }): AdapterUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role, emailVerified: null };
}
export const authorAdapter: Adapter = {
  async createUser(profile) {
    if (!profile.email) throw new Error("An email address is required");
    const row = await prisma.author.create({ data: {
      name: profile.name?.trim().slice(0, 100) || "Lecteur",
      email: profile.email.trim().toLowerCase(),
      role: "READER",
      welcomeCompleted: false,
      // OAuth accounts cannot authenticate with a guessed/default password.
      passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 12),
    } });
    return user(row);
  },
  async getUser(id) {
    const row = await prisma.author.findUnique({ where: { id } });
    return row ? user(row) : null;
  },
  async getUserByEmail(email) {
    const row = await prisma.author.findUnique({ where: { email: email.trim().toLowerCase() } });
    return row ? user(row) : null;
  },
  async getUserByAccount(key) {
    const account = await prisma.oAuthAccount.findUnique({ where: { provider_providerAccountId: key }, include: { author: true } });
    return account ? user(account.author) : null;
  },
  async updateUser(profile) {
    // OAuth must not change an existing account's email, role or permissions.
    const row = await prisma.author.findUniqueOrThrow({ where: { id: profile.id } });
    return user(row);
  },
  async linkAccount(account) {
    await prisma.oAuthAccount.create({ data: { provider: account.provider, providerAccountId: account.providerAccountId, authorId: account.userId } });
  },
};
