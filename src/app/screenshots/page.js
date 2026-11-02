import AppShell from '@/components/AppShell'
import ScreenshotBundles from '@/components/ScreenshotBundles'

export const metadata = {
  title: 'Screenshot upload',
}

export default function Page() {
  return (
    <AppShell>
      <ScreenshotBundles />
    </AppShell>
  )
}
