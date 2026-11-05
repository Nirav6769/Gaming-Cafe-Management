import "server-only";

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import {
  decideProfileAccess,
  isValidProfileMapping,
  type AppRole,
  type ProfileMapping,
} from "@/lib/auth-policy";

export type { AppRole } from "@/lib/auth-policy";

export type UserProfile = ProfileMapping & {
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

  const mapping: ProfileMapping = {
    authUserId: row.auth_user_id,
    role: row.role,
    staffId: row.staff_id,
    customerId: row.customer_id,
  };

  if (!isValidProfileMapping(mapping)) return null;

  return {
    ...mapping,
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

  const identity = !error && data.user ? { id: data.user.id } : null;
  const profile = identity
    ? await profileForUser(identity.id, data.user?.email)
    : null;
  const decision = decideProfileAccess(identity, profile, allowedRoles);

  if (decision.kind === "unauthenticated") {
    return {
      response: NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      ),
    };
  }

  if (decision.kind === "missing-profile") {
    return {
      response: NextResponse.json(
        { error: "Your account is not linked to a valid café profile. Contact an administrator." },
        { status: 403 },
      ),
    };
  }

  if (decision.kind === "forbidden") {
    return {
      response: NextResponse.json(
        { error: "You do not have permission to perform this action." },
        { status: 403 },
      ),
    };
  }

  return {
    profile: {
      ...decision.profile,
      email: data.user?.email ?? null,
    },
  };
}

export async function requirePageRole(allowedRoles: AppRole[]) {
  const profile = await getCurrentUserProfile();

  if (!profile) redirect("/login");
  if (!allowedRoles.includes(profile.role)) redirect("/forbidden");

  return profile;
}
