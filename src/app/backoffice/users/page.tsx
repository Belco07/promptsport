import Link from "next/link";

import { RoleBadge } from "@/components/RoleBadge";
import { prisma } from "@/lib/prisma";

import { DeleteUserButton } from "./DeleteUserButton";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

export default async function UsersPage() {
  const users = await prisma.author.findMany({
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="px-8 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Utilisateurs
        </h1>
        <Link
          href="/backoffice/users/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
        >
          Nouvel utilisateur
        </Link>
      </div>

      {users.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Aucun utilisateur.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Nom</th>
                <th scope="col" className="px-4 py-3 font-semibold">Email</th>
                <th scope="col" className="px-4 py-3 font-semibold">Rôle</th>
                <th scope="col" className="px-4 py-3 font-semibold">Créé le</th>
                <th scope="col" className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-muted">
                  <td className="px-4 py-3 font-medium text-foreground">{user.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                  <td className="px-4 py-3">
                    <RoleBadge role={user.role} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <time dateTime={user.createdAt.toISOString()}>
                      {dateFormatter.format(user.createdAt)}
                    </time>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/backoffice/users/${user.id}/edit`}
                        className="text-editorial-link underline hover:text-editorial-link"
                      >
                        Éditer
                      </Link>
                      <DeleteUserButton id={user.id} name={user.name} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
