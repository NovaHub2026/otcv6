import { redirect } from 'next/navigation';

/**
 * The panel has one submenu, so the root is that submenu.
 *
 * A redirect rather than a duplicate page: when the second submenu arrives, the
 * root becomes a choice rather than two copies of one screen.
 */
export default function Page(): never {
  redirect('/preview');
}
