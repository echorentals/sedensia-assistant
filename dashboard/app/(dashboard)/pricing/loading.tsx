import { Card, CardContent, CardHeader } from '@/components/ui/card';

export default function PricingLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 w-44 bg-slate-200 rounded animate-pulse" />
        <div className="h-4 w-56 bg-slate-200 rounded animate-pulse mt-2" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-12 bg-slate-200 rounded animate-pulse" />
              <div className="h-3 w-16 bg-slate-200 rounded animate-pulse mt-1" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 bg-slate-200 rounded animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
