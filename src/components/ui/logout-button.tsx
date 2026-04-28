"use client";

export function LogoutButton() {
  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
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
