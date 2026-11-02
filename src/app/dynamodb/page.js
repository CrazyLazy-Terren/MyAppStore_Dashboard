import AppShell from '@/components/AppShell'
import DynamoDBReader from '@/components/DynamoDBReader'

export const metadata = {
  title: 'DynamoDB reader',
}

export default function Page() {
  return (
    <AppShell>
      <DynamoDBReader />
    </AppShell>
  )
}
