"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setError("Unable to sign in. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell min-h-screen items-center justify-center">
      <section className="panel mx-auto w-full max-w-md p-8">
        <div className="brand mb-8">
          <div className="brand-mark">GC</div>
          <div><strong>GAMEHUB</strong><small>CAFE MANAGEMENT</small></div>
        </div>
        <span className="eyebrow">SECURE ACCESS</span>
        <h1 className="mb-2 mt-2 text-3xl font-semibold">Welcome back</h1>
        <p className="mb-6 text-sm text-slate-500">Sign in with the account provided by your café administrator.</p>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label className="grid gap-2 text-sm font-medium">
            Email address
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your password"
            />
          </label>
          {error && <p className="alert error" role="alert">{error}</p>}
          <button className="primary-btn" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
