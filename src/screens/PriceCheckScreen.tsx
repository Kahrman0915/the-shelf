import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRecord } from '@/data/hooks';
import { PriceCheck } from '@/ui/PriceCheck';

export function PriceCheckScreen() {
  const { id } = useParams();
  const record = useRecord(id);
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const backHref = query ? `/show?q=${encodeURIComponent(query)}` : '/show';

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <Button asChild variant="ghost" className="h-12 w-fit rounded-lg px-3 text-[15px] font-semibold">
        <Link to={backHref}>
          <ArrowLeft className="size-5" />
          Back to search
        </Link>
      </Button>
      {record === undefined ? null : record === null ? (
        <p className="text-ink-muted">That record isn’t on this phone.</p>
      ) : (
        <>
          <div>
            <div className="text-[17px] leading-[22px] font-bold">{record.artist}</div>
            <div className="text-[15px] leading-5 text-ink-muted">{record.title}</div>
          </div>
          <PriceCheck record={record} />
        </>
      )}
    </main>
  );
}
