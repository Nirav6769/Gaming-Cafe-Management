import { requirePageRole } from "@/lib/auth";
import GamesClient from "@/components/games/GamesClient";

export const dynamic = "force-dynamic";

export default async function GamesPage() {
  const profile = await requirePageRole(["admin", "staff", "customer"]);
  return <GamesClient role={profile.role} customerId={profile.customerId} />;
}
