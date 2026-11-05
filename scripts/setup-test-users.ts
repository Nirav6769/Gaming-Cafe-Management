import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";

async function main() {
  try {
    process.loadEnvFile?.(".env.local");
  } catch {}

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const databaseUrl = process.env.DATABASE_URL;

  if (!supabaseUrl || !supabaseKey || !databaseUrl) {
    console.error("Missing Supabase or Database URL in .env.local");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
  });

  const accounts = [
    { email: "admin@gamehub.com", password: "Password123!", role: "admin", staffId: 3, customerId: null },
    { email: "staff@gamehub.com", password: "Password123!", role: "staff", staffId: 2, customerId: null },
    { email: "alice@example.com", password: "Password123!", role: "customer", staffId: null, customerId: 1 }
  ];

  try {
    for (const acc of accounts) {
      console.log(`Setting up ${acc.role} account: ${acc.email}...`);

      // Sign up via Supabase Auth API
      const { error } = await supabase.auth.signUp({
        email: acc.email,
        password: acc.password
      });

      if (error && !error.message.includes("already registered")) {
        console.warn(`SignUp warning for ${acc.email}:`, error.message);
      }

      // Query user ID from auth.users
      const userRes = await pool.query(
        "SELECT id FROM auth.users WHERE email = $1;",
        [acc.email]
      );

      if (userRes.rows.length === 0) {
        console.error(`User ${acc.email} not found in auth.users!`);
        continue;
      }

      const authUserId = userRes.rows[0].id;

      // Confirm email automatically
      await pool.query(
        "UPDATE auth.users SET email_confirmed_at = CURRENT_TIMESTAMP WHERE id = $1;",
        [authUserId]
      );

      // Link in public.user_profiles
      if (acc.role === "admin" || acc.role === "staff") {
        await pool.query(`
          INSERT INTO public.user_profiles (auth_user_id, role, staff_id, customer_id)
          VALUES ($1, $2, $3, NULL)
          ON CONFLICT (auth_user_id) DO UPDATE
          SET role = EXCLUDED.role, staff_id = EXCLUDED.staff_id, customer_id = NULL;
        `, [authUserId, acc.role, acc.staffId]);
      } else {
        await pool.query(`
          INSERT INTO public.user_profiles (auth_user_id, role, staff_id, customer_id)
          VALUES ($1, $2, NULL, $3)
          ON CONFLICT (auth_user_id) DO UPDATE
          SET role = EXCLUDED.role, customer_id = EXCLUDED.customer_id, staff_id = NULL;
        `, [authUserId, acc.role, acc.customerId]);
      }

      console.log(`✓ ${acc.role.toUpperCase()} configured: ${acc.email} (Auth ID: ${authUserId})`);
    }

    console.log("\nAll accounts are ready to log in!");
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error("Setup error:", err);
  process.exit(1);
});
