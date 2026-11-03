import "server-only";

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

export type AppRole = "admin" | "staff" | "customer";

export type UserProfile = {
  authUserId: string;
  role: AppRole;
  staffId: number | null;
  customerId: number | null;
  email: string | null;
};

type ProfileRow = {
  auth_user_id: string;
  role: AppRole;
  staff_id: number | null;
  customer_id: number | null;
};

async function profileForUser(userId: string, email: string | undefined) {
  const result = await query<ProfileRow>(
    `SELECT auth_user_id, role, staff_id, customer_id
     FROM public.user_profiles
     WHERE auth_user_id = $1
     LIMIT 1`,
    [userId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    authUserId: row.auth_user_id,
    role: row.role,
    staffId: row.staff_id,
    customerId: row.customer_id,
    email: email ?? null,
  } satisfies UserProfile;
}

export async function getCurrentUserProfile(): Promise<UserProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) return null;
  return profileForUser(data.user.id, data.user.email);
}

export type ApiRoleResult =
  | { profile: UserProfile; response?: never }
  | { profile?: never; response: NextResponse };

export async function requireApiRole(
  allowedRoles: AppRole[],
): Promise<ApiRoleResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return {
      response: NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      ),
    };
  }

  const profile = await profileForUser(data.user.id, data.user.email);
  if (!profile) {
    return {
      response: NextResponse.json(
        { error: "Your account is not linked to a café profile. Contact an administrator." },
        { status: 403 },
      ),
    };
  }

  if (!allowedRoles.includes(profile.role)) {
    return {
      response: NextResponse.json(
        { error: "You do not have permission to perform this action." },
        { status: 403 },
      ),
    };
  }

  return { profile };
}

export async function requirePageRole(allowedRoles: AppRole[]) {
  const profile = await getCurrentUserProfile();

  if (!profile) redirect("/login");
  if (!allowedRoles.includes(profile.role)) redirect("/forbidden");

  return profile;
}
