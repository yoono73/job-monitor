"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail]     = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState("");

  const supabase = createClient();

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setLoading("email");
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setLoading(null);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function handleGoogleLogin() {
    setLoading("google");
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) { setError(error.message); setLoading(null); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-[#0d1117]">
      <div className="w-full max-w-sm">

        {/* 로고 */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🍀</div>
          <h1 className="text-2xl font-bold text-[#FFD700]">로또 분석기</h1>
          <p className="text-[#8b949e] mt-1 text-xs">확률과 통계 기반 번호 추천</p>
        </div>

        <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-7 shadow-2xl">
          {!sent ? (
            <>
              {/* Google 버튼 */}
              <button
                onClick={handleGoogleLogin}
                disabled={loading !== null}
                className="w-full py-3.5 bg-white hover:bg-gray-50 text-gray-800 font-semibold rounded-xl flex items-center justify-center gap-3 transition disabled:opacity-50 shadow-sm text-sm"
              >
                {loading === "google" ? "로그인 중..." : <><GoogleIcon />Google로 로그인</>}
              </button>

              {/* 구분선 */}
              <div className="flex items-center my-5">
                <div className="flex-1 h-px bg-[#30363d]" />
                <span className="px-3 text-xs text-[#484f58]">또는 이메일로</span>
                <div className="flex-1 h-px bg-[#30363d]" />
              </div>

              {/* 이메일 */}
              <form onSubmit={handleEmailLogin} className="space-y-3">
                <div>
                  <label className="block text-xs text-[#8b949e] mb-1.5">이메일 주소</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    required
                    className="w-full px-4 py-3 bg-[#0d1117] border border-[#30363d] rounded-xl text-white placeholder-[#484f58] focus:outline-none focus:border-[#00C896] focus:ring-1 focus:ring-[#00C896] transition text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading !== null || !email}
                  className="w-full py-3.5 bg-[#00C896] hover:bg-[#00b085] text-black font-bold rounded-xl transition disabled:opacity-40 disabled:cursor-not-allowed text-sm"
                >
                  {loading === "email" ? "전송 중..." : "이메일로 로그인"}
                </button>
              </form>

              {/* 안내 문구 */}
              <p className="mt-4 text-xs text-[#484f58] text-center leading-relaxed">
                이메일로 로그인 링크를 보내드립니다<br/>
                비밀번호가 필요 없어요
              </p>

              {error && (
                <p className="mt-3 text-xs text-red-400 text-center">{error}</p>
              )}

              <p className="mt-4 text-xs text-[#30363d] text-center">
                처음이면 자동으로 계정이 만들어져요
              </p>
            </>
          ) : (
            <div className="text-center py-4">
              <div className="text-4xl mb-4">📬</div>
              <h2 className="text-lg font-bold text-white mb-2">메일을 확인해주세요!</h2>
              <p className="text-[#8b949e] text-sm leading-relaxed">
                <span className="text-[#00C896] font-medium">{email}</span>으로<br/>
                로그인 링크를 보냈습니다
              </p>
              <p className="text-[#484f58] text-xs mt-3">메일의 링크를 클릭하면 자동으로 로그인돼요</p>
              <button
                onClick={() => { setSent(false); setEmail(""); }}
                className="mt-5 text-xs text-[#484f58] hover:text-white underline transition"
              >
                다시 시도
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}
