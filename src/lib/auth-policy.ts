export type AppRole = "admin" | "staff" | "customer";

export type ProfileMapping = {
  authUserId: string;
  role: AppRole;
  staffId: number | null;
  customerId: number | null;
};

export type AuthIdentity = {
  id: string;
};

export type AccessDecision =
  | { kind: "unauthenticated" }
  | { kind: "missing-profile" }
  | { kind: "forbidden"; profile: ProfileMapping }
  | { kind: "authorized"; profile: ProfileMapping };

export function isValidProfileMapping(profile: ProfileMapping): boolean {
  if (!profile.authUserId) return false;

  if (profile.role === "admin" || profile.role === "staff") {
    return Number.isInteger(profile.staffId) &&
      (profile.staffId ?? 0) > 0 &&
      profile.customerId === null;
  }

  if (profile.role === "customer") {
    return Number.isInteger(profile.customerId) &&
      (profile.customerId ?? 0) > 0 &&
      profile.staffId === null;
  }

  return false;
}

export function decideProfileAccess(
  user: AuthIdentity | null,
  profile: ProfileMapping | null,
  allowedRoles: AppRole[],
): AccessDecision {
  if (!user) return { kind: "unauthenticated" };

  if (
    !profile ||
    profile.authUserId !== user.id ||
    !isValidProfileMapping(profile)
  ) {
    return { kind: "missing-profile" };
  }

  if (!allowedRoles.includes(profile.role)) {
    return { kind: "forbidden", profile };
  }

  return { kind: "authorized", profile };
}
