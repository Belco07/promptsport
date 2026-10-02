import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";

import { updateUser } from "../../actions";
import { UserForm } from "../../UserForm";

export const dynamic = "force-dynamic";

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await prisma.author.findUnique({ where: { id } });

  if (!user) {
    notFound();
  }

  const updateWithId = updateUser.bind(null, user.id);

  return (
    <div className="px-8 py-10">
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-gray-900">
        Modifier l&apos;utilisateur
      </h1>
      <p className="mb-6 text-sm text-gray-500">{user.email}</p>

      <UserForm
        action={updateWithId}
        mode="edit"
        defaultValues={{ name: user.name, email: user.email, role: user.role }}
        submitLabel="Mettre à jour"
      />
    </div>
  );
}
