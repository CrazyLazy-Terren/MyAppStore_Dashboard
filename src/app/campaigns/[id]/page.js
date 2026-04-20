import AppShell from '@/components/AppShell'
import CampaignDetail from '@/components/CampaignDetail'

export default async function CampaignDetailPage({ params }) {
  const { id } = await params

  return (
    <AppShell>
      <CampaignDetail id={id} />
    </AppShell>
  )
}
