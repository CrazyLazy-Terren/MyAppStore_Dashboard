import './globals.css'

export const metadata = {
  title: 'App Growth Console',
  description: 'Apple Ads, App Store Connect listings, and download analytics in one dashboard',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
