import type { ReactNode } from 'react';
import { QueryProvider } from '@/app/providers/query-provider';
import '@/app/styles/globals.css';

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="ko"><body><QueryProvider>{children}</QueryProvider></body></html>;
}
