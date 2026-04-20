import AppShell from '@/components/AppShell'
import AppStoreConnect from '@/components/AppStoreConnect'

export const metadata = {
  title: 'App Store Connect',
}

export default function Page() {
  return (
    <AppShell>
      <AppStoreConnect />
    </AppShell>
  )
}
