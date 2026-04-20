import './globals.css'

export const metadata = {
  title: 'Apple Search Ads Manager',
  description: 'Apple Search Ads operations dashboard with Next.js',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
