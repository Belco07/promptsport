import { createTeam } from "../../actions";
import { TeamForm } from "../../TeamForm";

export default function NewTeamPage() {
  return (
    <div className="px-8 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-gray-900">Nouvelle équipe</h1>
      <TeamForm action={createTeam} submitLabel="Créer l'équipe" />
    </div>
  );
}
