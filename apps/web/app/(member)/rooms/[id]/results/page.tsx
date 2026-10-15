import { notFound } from 'next/navigation';
import { ResultsPage } from '@/features/results/ResultsPage';
import { isUuid } from '@/features/room/ids';

export const metadata = { title: 'Results' };

/** S13 card results / S27 auction results and analysis. */
export default async function ResultsRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <ResultsPage roomId={id} />;
}
