import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ADMIN_COOKIE } from "@/lib/auth";
import { serverEnv } from "@/lib/env";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string };
}) {
  async function login(formData: FormData) {
    "use server";
    const password = String(formData.get("password") ?? "");
    const next = String(formData.get("next") ?? "/admin");
    if (password !== serverEnv.adminPassword()) {
      redirect(`/admin/login?error=1&next=${encodeURIComponent(next)}`);
    }
    cookies().set(ADMIN_COOKIE, password, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    redirect(next);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form action={login} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold">Admin login</h1>
        <input type="hidden" name="next" value={searchParams.next ?? "/admin"} />
        <input
          type="password"
          name="password"
          autoFocus
          required
          placeholder="Password"
          className="w-full px-3 py-2 rounded bg-neutral-900 border border-neutral-700"
        />
        {searchParams.error && (
          <p className="text-sm text-red-400">Incorrect password.</p>
        )}
        <button className="w-full px-3 py-2 rounded bg-white text-black font-medium">
          Sign in
        </button>
      </form>
    </main>
  );
}
