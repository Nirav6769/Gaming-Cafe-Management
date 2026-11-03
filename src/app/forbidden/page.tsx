import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="app-shell min-h-screen items-center justify-center">
      <section className="panel mx-auto w-full max-w-lg p-8 text-center">
        <span className="eyebrow">ACCESS RESTRICTED</span>
        <h1 className="mb-3 mt-2 text-3xl font-semibold">Account access not configured</h1>
        <p className="mb-6 text-sm text-slate-500">
          Your account is signed in, but it does not have a linked café profile
          or the role required for this page. Ask an administrator to link your
          account to a staff or customer record.
        </p>
        <Link className="text-btn" href="/login">Return to sign in →</Link>
      </section>
    </main>
  );
}
