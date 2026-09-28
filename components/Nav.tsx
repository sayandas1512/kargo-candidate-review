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
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <span className="font-semibold">Kargo Hiring</span>
          <nav className="flex gap-4 text-sm">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={pathname === l.href ? "font-medium text-black" : "text-gray-500 hover:text-black"}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <button onClick={logout} className="text-sm text-gray-500 hover:text-black">
          Sign out
        </button>
      </div>
    </header>
  );
}
