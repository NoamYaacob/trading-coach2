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
        className="block w-full px-4 py-2 text-left text-[13.5px] transition-colors"
        style={{ color: "var(--gr-text-mid)" }}
      >
        Log out
      </button>
    );
  }

  return (
    <button
      onClick={handleLogout}
      className="shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13.5px] transition-opacity hover:opacity-70 sm:px-4 sm:py-2"
      style={{ color: "var(--gr-text-mid)" }}
    >
      Log out
    </button>
  );
}
