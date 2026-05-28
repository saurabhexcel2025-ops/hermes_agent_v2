"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#020305" }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <img src="/spacearmour-logo.svg" alt="SpaceArmour" className="h-9 w-auto" draggable={false} />
        </div>

        {/* Card */}
        <div
          className="rounded-xl p-8 border"
          style={{
            background: "#080c14",
            borderColor: "rgba(77,208,248,0.15)",
            boxShadow: "0 0 40px rgba(77,208,248,0.04)",
          }}
        >
          <h1 className="text-lg font-semibold text-white mb-1">Sign in</h1>
          <p className="text-sm text-white/40 mb-6">Access your mission control dashboard</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5 tracking-wide uppercase">
                Email
              </label>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3.5 py-2.5 rounded-lg text-sm text-white placeholder-white/20 outline-none transition-all focus:ring-1"
                style={{
                  background: "#0e1420",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "rgba(77,208,248,0.5)";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(77,208,248,0.08)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/50 mb-1.5 tracking-wide uppercase">
                Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 rounded-lg text-sm text-white placeholder-white/20 outline-none transition-all"
                style={{
                  background: "#0e1420",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "rgba(77,208,248,0.5)";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(77,208,248,0.08)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
            </div>

            {error && (
              <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: loading ? "rgba(77,208,248,0.5)" : "#4DD0F8",
                color: "#020305",
              }}
              onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = "#7de0fa"; }}
              onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = "#4DD0F8"; }}
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-white/30 mt-5">
          No account?{" "}
          <Link href="/signup" className="text-[#4DD0F8] hover:text-[#7de0fa] transition-colors">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
