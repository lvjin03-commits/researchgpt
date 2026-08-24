import type { ReactNode } from "react";

export function AccountPlaceholder({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#dbe4e7] bg-white p-6 shadow-sm sm:p-8">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#e7f0f4] text-[#174866]">
        {icon}
      </div>
      <h2 className="mt-5 text-xl font-semibold text-[#172126]">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#607078]">{description}</p>
      <span className="mt-5 inline-flex rounded-full bg-[#f1f4f5] px-3 py-1 text-xs font-semibold text-[#607078]">
        即将开放
      </span>
    </section>
  );
}
