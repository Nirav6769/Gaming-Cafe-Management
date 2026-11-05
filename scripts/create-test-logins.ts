import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";

async function main() {
  try {
    process.loadEnvFile?.(".env.local");
  } catch {}

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const accounts = [
    { email: "admin@gamehub.com", role: "admin", staffId: 3, customerId: null },
    { email: "staff@gamehub.com", role: "staff", staffId: 2, customerId: null },
    { email: "alice@example.com", role: "customer", staffId: null, customerId: 1 }
  ];

  try {
    for (const acc of accounts) {
      console.log(`Setting up ${acc.role.toUpperCase()}: ${acc.email}...`);

      // 1. Check if user already exists in auth.users
      const existing = await pool.query(
        "SELECT id FROM auth.users WHERE email = $1;",
        [acc.email]
      );

      let userId: string;
      if (existing.rows.length > 0) {
        userId = existing.rows[0].id;
        // Clean up identities and user_profiles to ensure consistent schema
        await pool.query("DELETE FROM public.user_profiles WHERE auth_user_id = $1;", [userId]);
        await pool.query("DELETE FROM auth.identities WHERE user_id = $1;", [userId]);
        await pool.query("DELETE FROM auth.users WHERE id = $1;", [userId]);
      }

      // Generate new UUID if needed
      const idRes = await pool.query("SELECT gen_random_uuid() AS id;");
      userId = idRes.rows[0].id;

      // 2. Insert into auth.users with all expected GoTrue defaults
      await pool.query(`
        INSERT INTO auth.users (
          instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          invited_at, confirmation_token, confirmation_sent_at, recovery_token, recovery_sent_at,
          email_change_token_new, email_change, email_change_sent_at, last_sign_in_at,
          raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at,
          phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at,
          email_change_token_current, email_change_confirm_status, banned_until,
          reauthentication_token, reauthentication_sent_at, is_sso_user, deleted_at, is_anonymous
        ) VALUES (
          '00000000-0000-0000-0000-000000000000',
          $1::uuid,
          'authenticated',
          'authenticated',
          $2::text,
          extensions.crypt('Password123!', extensions.gen_salt('bf', 10)),
          CURRENT_TIMESTAMP,
          NULL, '', NULL, '', NULL,
          '', '', NULL, NULL,
          '{"provider":"email","providers":["email"]}'::jsonb,
          json_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true, 'phone_verified', false)::jsonb,
          NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
          NULL, NULL, '', '', NULL,
          '', 0, NULL,
          '', NULL, FALSE, NULL, FALSE
        );
      `, [userId, acc.email]);

      // 3. Insert into auth.identities
      await pool.query(`
        INSERT INTO auth.identities (
          id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
        ) VALUES (
          gen_random_uuid(),
          $1::text,
          $1::uuid,
          json_build_object('sub', $1::text, 'email', $2::text, 'email_verified', true, 'phone_verified', false)::jsonb,
          'email',
          NULL,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        );
      `, [userId, acc.email]);

      // 4. Link into public.user_profiles
      if (acc.role === "admin" || acc.role === "staff") {
        await pool.query(`
          INSERT INTO public.user_profiles (auth_user_id, role, staff_id, customer_id)
          VALUES ($1, $2, $3, NULL);
        `, [userId, acc.role, acc.staffId]);
      } else {
        await pool.query(`
          INSERT INTO public.user_profiles (auth_user_id, role, staff_id, customer_id)
          VALUES ($1, $2, NULL, $3);
        `, [userId, acc.role, acc.customerId]);
      }

      console.log(`✓ Configured: ${acc.role.toUpperCase()} -> ${acc.email} (Auth ID: ${userId})`);
    }

    console.log("\nVerifying Supabase client sign-ins...");
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    );

    for (const acc of accounts) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: acc.email,
        password: "Password123!"
      });
      if (error) {
        console.error(`✗ Sign-in verification failed for ${acc.email}:`, error.message);
        process.exitCode = 1;
      } else {
        console.log(`✓ Verification passed for ${acc.role.toUpperCase()} (${acc.email}) -> Token received`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
