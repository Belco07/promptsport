import { createUser } from "../actions";
import { UserForm } from "../UserForm";

export default function NewUserPage() {
  return (
    <div className="px-8 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-gray-900">
        Nouvel utilisateur
      </h1>

      <UserForm action={createUser} mode="create" submitLabel="Créer l'utilisateur" />
    </div>
  );
}
