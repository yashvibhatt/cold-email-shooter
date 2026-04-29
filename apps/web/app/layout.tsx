import type { Metadata } from 'next';
import './globals.css';
import QueryProvider from '@/components/QueryProvider';

export const metadata: Metadata = {
  title: 'Cold Email Shooter — Outlook Scheduler',
  description: 'Schedule and send bulk emails through your Outlook account',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="bg-canvas min-h-screen antialiased">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
