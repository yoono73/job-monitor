"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useState } from "react";

/* ─── Ball ─── */
function ballColor(n: number) {
  if (n <= 10) return "bg-[#FBC400] text-black";
  if (n <= 20) return "bg-[#069FDD] text-white";
  if (n <= 30) return "bg-[#FF5757] text-white";
  if (n <= 40) return "bg-[#AAAAAA] text-white";
  return "bg-[#B0D840] text-black";
}
function Ball({ n }: { n: number }) {
  return (
    <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full font-bold text-sm shrink-0 shadow-sm ${ballColor(n)}`}>
      {n}
    </span>
  );
}

/* ─── Main Content ─── */
function ShareContent() {
  const params = useSearchParams();
  const raw    = params.get("s") ?? "";
  const drawNo = params.get("t");
  const [copied, setCopied] = useState<number | null>(null);
  const [allCopied, setAllCopied] = useState(false);

  // Parse: "1-2-3-4-5-6_7-8-9-10-11-12"
  const sets: number[][] = raw
    .split("_")
    .map(s => s.split("-").map(Number))
    .filter(s => s.length === 6 && s.every(n => n >= 1 && n <= 45));

  const copySet = (nums: number[], idx: number) => {
    navigator.clipboard.writeText(nums.join("  "));
    setCopied(idx); setTimeout(() => setCopied(null), 1500);
  };

  const copyAll = () => {
    const text = sets.map((s, i) => `${i + 1}. ${s.join("  ")}`).join("\n");
    navigator.clipboard.writeText(text);
    setAllCopied(true); setTimeout(() => setAllCopied(false), 2000);
  };

  if (sets.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-5xl mb-4">🤔</div>
          <p className="text-gray-500 font-semibold">유효한 번호가 없어요</p>
          <Link href="/dashboard/generate"
            className="mt-4 inline-block text-sm text-amber-600 font-bold hover:underline">
            번호 생성하러 가기 →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 max-w-lg mx-auto">

      {/* 헤더 */}
      <div className="text-center mb-8">
        <div className="text-4xl mb-2">🍀</div>
        <h1 className="text-xl font-extrabold text-gray-800">공유된 로또 번호</h1>
        {drawNo && (
          <p className="text-sm text-amber-600 font-bold mt-1">
            제 {drawNo}회 추천 번호 · {sets.length}게임
          </p>
        )}
        {!drawNo && (
          <p className="text-sm text-gray-400 mt-1">{sets.length}게임</p>
        )}
      </div>

      {/* 번호 카드 */}
      <div className="space-y-3 mb-6">
        {sets.map((nums, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-gray-400">{i + 1}번</span>
              <button
                onClick={() => copySet(nums, i)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition
                  ${copied === i
                    ? "bg-amber-50 border-amber-300 text-amber-600"
                    : "text-gray-400 border-gray-200 hover:text-gray-600 hover:border-gray-400"}`}>
                {copied === i ? "✓ 복사됨" : "복사"}
              </button>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {nums.map((n, j) => <Ball key={j} n={n} />)}
            </div>
          </div>
        ))}
      </div>

      {/* 전체 복사 */}
      <button onClick={copyAll}
        className={`w-full py-3.5 rounded-2xl font-bold text-sm mb-4 border transition
          ${allCopied
            ? "bg-emerald-50 border-emerald-300 text-emerald-600"
            : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"}`}>
        {allCopied ? "✓ 전체 번호 복사됨!" : "📋 전체 번호 복사"}
      </button>

      {/* 앱으로 이동 */}
      <Link href="/dashboard/generate"
        className="block w-full py-3.5 rounded-2xl font-bold text-sm text-center
          bg-slate-700 hover:bg-slate-800 text-white transition">
        🎰 내 번호 직접 생성하기
      </Link>

      {/* 안내 */}
      <p className="text-center text-xs text-gray-300 mt-6">
        로또 분석기 · 1,227회 통계 기반 · 당첨 보장 아님 😊
      </p>
    </div>
  );
}

/* ─── Page ─── */
export default function SharePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-3xl animate-pulse">🍀</div>
      </div>
    }>
      <ShareContent />
    </Suspense>
  );
}
