import { createCompetition } from "../../actions";
import { CompetitionForm } from "../../CompetitionForm";

export default function NewCompetitionPage() {
  return (
    <div className="px-8 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-gray-900">
        Nouvelle compétition
      </h1>
      <CompetitionForm action={createCompetition} submitLabel="Créer la compétition" />
    </div>
  );
}
