export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden animate-pulse">
      <div className="h-10 bg-slate-50 border-b border-slate-200 px-4 flex items-center gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="h-3 bg-slate-200 rounded flex-1" />
        ))}
      </div>
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="h-11 px-4 flex items-center gap-4">
            {Array.from({ length: cols }).map((__, c) => (
              <div key={c} className="h-3 bg-slate-100 rounded flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 animate-pulse">
      <div className="lg:col-span-8 space-y-5">
        <div className="h-52 bg-white border border-slate-200 rounded-lg" />
        <div className="h-64 bg-white border border-slate-200 rounded-lg" />
        <div className="h-60 bg-white border border-slate-200 rounded-lg" />
      </div>
      <div className="lg:col-span-4 space-y-5">
        <div className="h-72 bg-white border border-slate-200 rounded-lg" />
        <div className="h-80 bg-white border border-slate-200 rounded-lg" />
      </div>
    </div>
  );
}
