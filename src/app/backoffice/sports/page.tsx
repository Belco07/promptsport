import { redirect } from "next/navigation";

/**
 * La section Sports redirige vers l'onglet Compétitions par défaut.
 */
export default function SportsPage() {
  redirect("/backoffice/sports/competitions");
}
