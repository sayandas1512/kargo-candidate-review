"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/upload", label: "Upload" },
  { href: "/rubric", label: "Rubric" },
  { href: "/audit", label: "Audit" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/login") return null;

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2 font-semibold text-gray-900">
            <span className="h-2 w-2 rounded-full bg-indigo-600" />
            Kargo Candidate Review
          </span>
          <nav className="flex gap-1 text-sm">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-3 py-1.5 transition-colors ${
                  pathname === l.href ? "bg-indigo-50 font-medium text-indigo-700" : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <button onClick={logout} className="rounded-full px-3 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900">
          Sign out
        </button>
      </div>
    </header>
  );
}
