import { redirect } from 'next/navigation';

// Retired web-product controls; the Android app does not use these editors.
export default function RetiredConexPage() {
  redirect('/conex');
}
