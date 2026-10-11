import { notFound } from 'next/navigation';
import { PreparationView } from '@/features/cards/arena/PreparationView';
import { isUuid } from '@/features/room/ids';

export const metadata = { title: 'Preparing match' };

/** S08 — card preparation. The deal already happened on the server; this page only reports it. */
export default async function PreparingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <PreparationView roomId={id} />;
}
