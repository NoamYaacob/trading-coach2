"use client";

type LogoutButtonProps = {
  variant?: "pill" | "menu";
};

export function LogoutButton({ variant = "pill" }: LogoutButtonProps) {
  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  if (variant === "menu") {
    return (
      <button
        onClick={handleLogout}
        className="block w-full px-4 py-2 text-left text-sm text-stone-700 hover:bg-stone-50 hover:text-stone-950"
      >
        Log out
      </button>
    );
  }

  return (
    <button
      onClick={handleLogout}
      className="shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs text-stone-500 transition hover:text-stone-950 sm:px-4 sm:py-2 sm:text-sm"
    >
      Log out
    </button>
  );
}
