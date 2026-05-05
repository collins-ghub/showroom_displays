import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">Showroom Display</h1>
      <div className="flex gap-4">
        <Link href="/display" className="px-4 py-2 rounded bg-white text-black">
          Display
        </Link>
        <Link href="/admin" className="px-4 py-2 rounded border border-white/30">
          Admin
        </Link>
      </div>
    </main>
  );
}
