import { redirect } from "next/navigation";
import { getCurrentUserProfile } from "@/lib/auth";

export default async function HomePage() {
  const profile = await getCurrentUserProfile();

  if (!profile) redirect("/login");
  if (profile.role === "customer") redirect("/forbidden");

  redirect("/dashboard");
}
