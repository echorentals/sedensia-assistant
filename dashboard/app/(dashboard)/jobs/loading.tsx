export default function JobsLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 w-32 bg-slate-200 rounded animate-pulse" />
        <div className="h-4 w-56 bg-slate-200 rounded animate-pulse mt-2" />
      </div>

      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-slate-200 rounded animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
