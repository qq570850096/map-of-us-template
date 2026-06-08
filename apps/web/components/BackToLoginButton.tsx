"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { logout } from "@/lib/apiClient";

export default function BackToLoginButton() {
  const router = useRouter();
  const [working, setWorking] = useState(false);

  const backToLogin = async () => {
    if (working) return;
    setWorking(true);

    await logout();

    router.push("/");
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={backToLogin}
      disabled={working}
      aria-label="返回密码页"
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#D8DDD8]/85 bg-[#FAFBF7]/82 text-sm font-semibold text-[#5A6670]/72 shadow-[0_10px_24px_rgba(90,102,112,0.08)] backdrop-blur transition hover:border-[#F5DCE0] hover:text-[#5A6670] disabled:opacity-50 sm:flex sm:h-11 sm:w-auto sm:gap-2 sm:px-4 sm:py-2"
    >
      <Lock className="h-4 w-4 text-[#A8C8DC]" />
      <span className="hidden sm:inline">返回密码页</span>
    </button>
  );
}
