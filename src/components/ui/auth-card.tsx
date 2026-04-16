import type { ReactNode } from "react";

type AuthCardProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function AuthCard({ title, description, children }: AuthCardProps) {
  return (
    <div className="mx-auto w-full max-w-md rounded-[2rem] border border-stone-200 bg-white/95 p-8 shadow-[0_25px_70px_-45px_rgba(28,25,23,0.45)]">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold tracking-[-0.04em] text-stone-950">
          {title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">{description}</p>
      </div>
      {children}
    </div>
  );
}
