"use client";

import { Suspense } from "react";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MessageSquare, Lock, Mail, Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// useSearchParams() must be inside a <Suspense> boundary or Next.js bails out
// of static prerendering at build time. The default export wraps the real
// content in <Suspense>; the inner component does the actual work.
export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Email dan password wajib diisi");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Email atau password salah");
        return;
      }

      // Success, redirect
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("Gagal terhubung ke server. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-950 py-12 px-4 sm:px-6 lg:px-8">
      {/* Background gradients */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-blue-900/20 via-slate-950 to-slate-950 pointer-events-none" />
      <div className="absolute -top-40 -left-40 h-80 w-80 rounded-full bg-blue-600/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 h-80 w-80 rounded-full bg-emerald-600/10 blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-xl shadow-blue-500/20">
            <MessageSquare className="h-6 w-6 text-white" />
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-white mt-4">
            NextLib Cloud
          </h2>
          <p className="text-sm text-slate-400">
            Platform SaaS Otomatisasi & AI Pustakawan SLiMS
          </p>
        </div>

        <Card className="backdrop-blur-md bg-slate-900/60 border border-slate-800 shadow-2xl">
          <CardHeader>
            <CardTitle className="text-xl text-white">Masuk ke Dashboard</CardTitle>
            <CardDescription className="text-slate-400">
              Gunakan akun admin Anda untuk mengelola sistem.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              {error && (
                <Alert variant="destructive" className="bg-red-950/20 border-red-900/50 text-red-400">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Gagal Masuk</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="email" className="text-slate-300">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="nama@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    className="pl-10 bg-slate-950/50 border-slate-800 text-white placeholder-slate-500 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-300">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    className="pl-10 bg-slate-950/50 border-slate-800 text-white placeholder-slate-500 focus:border-blue-500 focus:ring-blue-500"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-700 font-semibold shadow-lg shadow-blue-500/25 transition-all py-2.5 rounded-lg"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Memproses...
                  </>
                ) : (
                  "Masuk ke Platform"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="text-center">
          <p className="text-xs text-slate-500">
            NextLib SaaS Platform &copy; 2026. Hak Cipta Dilindungi.
          </p>
        </div>
      </div>
    </div>
  );
}
