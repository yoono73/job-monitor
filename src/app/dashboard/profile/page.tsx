import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const displayName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email?.split("@")[0] ||
    "사용자";

  return (
    <div className="px-4 py-6 md:px-6 lg:px-8 max-w-md mx-auto md:max-w-lg">
      <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center mb-4 shadow-sm">
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center text-3xl mx-auto mb-3">
          👤
        </div>
        <h2 className="text-lg font-bold text-gray-800">{displayName}</h2>
        <p className="text-gray-400 text-sm mt-1">{user.email}</p>
      </div>

      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className="w-full py-3 text-sm font-semibold text-red-500 border border-red-200 hover:bg-red-50 rounded-xl transition"
        >
          로그아웃
        </button>
      </form>
    </div>
  );
}
