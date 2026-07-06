import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Download – Enterprise POS ERP',
  description: 'Download the Enterprise POS ERP desktop app for Windows.',
}

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
