import { redirect } from 'next/navigation';

export default function ForbiddenPage() {
  redirect('/');
}
