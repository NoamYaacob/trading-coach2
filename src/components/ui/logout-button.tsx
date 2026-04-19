"use client";

export function LogoutButton() {
  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <button
      onClick={handleLogout}
      className="rounded-full px-4 py-2 text-sm text-stone-500 transition hover:text-stone-950"
    >
      Log out
    </button>
  );
}
