import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { availableOAuthProviders } from "@/lib/oauth-providers";
import { RegisterForm } from "./RegisterForm";
export const metadata = { title: "Créer un compte" };
export default async function RegisterPage() {
  if ((await auth())?.user) redirect("/mon-compte");
  return <RegisterForm providers={availableOAuthProviders()} />;
}
