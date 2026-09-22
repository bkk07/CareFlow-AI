import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export function usePagination<T>(items: T[], opts?: { initialPage?: number; initialSize?: number }) {
  const [page, setPage] = useState(opts?.initialPage ?? 1);
  const [pageSize, setPageSize] = useState<number>(opts?.initialSize ?? 10);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);

  useEffect(() => {
    setPage(1);
  }, [total, pageSize]);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, safePage, pageSize]);

  return {
    page: safePage,
    setPage,
    pageSize,
    setPageSize,
    total,
    totalPages,
    pageItems,
    start: total === 0 ? 0 : (safePage - 1) * pageSize + 1,
    end: Math.min(safePage * pageSize, total),
  };
}

export function Pagination({
  page,
  totalPages,
  total,
  start,
  end,
  pageSize,
  onPage,
  onSize,
}: {
  page: number;
  totalPages: number;
  total: number;
  start: number;
  end: number;
  pageSize: number;
  onPage: (p: number) => void;
  onSize: (s: number) => void;
}) {
  if (total === 0) return null;
  const numbers = useMemo(() => {
    const out: (number | "…")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) out.push(i);
      return out;
    }
    const keep = new Set([1, 2, page - 1, page, page + 1, totalPages - 1, totalPages]);
    let last = 0;
    for (let i = 1; i <= totalPages; i++) {
      if (!keep.has(i)) continue;
      if (i - last > 1) out.push("…");
      out.push(i);
      last = i;
    }
    return out;
  }, [page, totalPages]);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 px-4 py-3 border-t border-border bg-white">
      <p className="text-[0.78rem] text-ink-secondary font-medium" aria-live="polite">
        Showing <strong className="text-ink">{start}–{end}</strong> of <strong className="text-ink">{total}</strong>
      </p>
      <div className="flex-1" />
      <label className="flex items-center gap-1.5 text-[0.78rem] font-semibold text-ink-secondary">
        Rows
        <select
          value={pageSize}
          onChange={(e) => onSize(Number(e.target.value))}
          className="bg-white border border-border rounded-lg px-2 py-1.5 text-[0.78rem] font-bold outline-none focus:border-healthcare"
          aria-label="Rows per page"
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-1" role="navigation" aria-label="Pagination">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="w-8 h-8 rounded-lg border border-border bg-white flex items-center justify-center text-ink-secondary hover:border-healthcare hover:text-healthcare transition disabled:opacity-40 disabled:hover:border-border disabled:hover:text-ink-secondary"
        >
          <ChevronLeft size={15} />
        </button>
        {numbers.map((n, i) =>
          n === "…" ? (
            <span key={`e${i}`} className="px-1 text-ink-faint text-[0.8rem]">…</span>
          ) : (
            <button
              key={n}
              onClick={() => onPage(n)}
              aria-current={n === page ? "page" : undefined}
              className={`min-w-[2rem] h-8 px-2 rounded-lg text-[0.8rem] font-bold border transition ${
                n === page
                  ? "bg-navy text-white border-navy"
                  : "bg-white text-ink-secondary border-border hover:border-healthcare hover:text-healthcare"
              }`}
            >
              {n}
            </button>
          ),
        )}
        <button
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
          className="w-8 h-8 rounded-lg border border-border bg-white flex items-center justify-center text-ink-secondary hover:border-healthcare hover:text-healthcare transition disabled:opacity-40 disabled:hover:border-border disabled:hover:text-ink-secondary"
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
