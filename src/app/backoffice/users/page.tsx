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
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Utilisateurs
        </h1>
        <Link
          href="/backoffice/users/new"
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800"
        >
          Nouvel utilisateur
        </Link>
      </div>

      {users.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-600">
          Aucun utilisateur.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Nom</th>
                <th scope="col" className="px-4 py-3 font-semibold">Email</th>
                <th scope="col" className="px-4 py-3 font-semibold">Rôle</th>
                <th scope="col" className="px-4 py-3 font-semibold">Créé le</th>
                <th scope="col" className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{user.name}</td>
                  <td className="px-4 py-3 text-gray-600">{user.email}</td>
                  <td className="px-4 py-3">
                    <RoleBadge role={user.role} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    <time dateTime={user.createdAt.toISOString()}>
                      {dateFormatter.format(user.createdAt)}
                    </time>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/backoffice/users/${user.id}/edit`}
                        className="text-blue-700 underline hover:text-blue-900"
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
