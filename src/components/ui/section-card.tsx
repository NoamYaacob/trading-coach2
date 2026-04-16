import type { ReactNode } from "react";

type SectionCardProps = {
  title: string;
  description?: string;
  children?: ReactNode;
};

export function SectionCard({ title, description, children }: SectionCardProps) {
  return (
    <section className="rounded-[1.75rem] border border-stone-200 bg-white/90 p-6 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.35)]">
      <div className="mb-5">
        <h2 className="text-xl font-semibold tracking-[-0.03em] text-stone-950">{title}</h2>
        {description ? <p className="mt-2 text-sm leading-6 text-stone-600">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
