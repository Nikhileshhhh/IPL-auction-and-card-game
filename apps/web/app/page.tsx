import { redirect } from 'next/navigation';

/** Entry point: everything begins at the access gate (S01). */
export default function Home() {
  redirect('/access');
}
