import AppShell from '@/components/AppShell'
import VideoStudio from '@/components/VideoStudio'

export const metadata = {
  title: 'Video Studio',
}

export default function Page() {
  return (
    <AppShell>
      <VideoStudio />
    </AppShell>
  )
}
