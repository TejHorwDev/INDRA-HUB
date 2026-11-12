import EmptyState from '../components/EmptyState'
import Page from '../components/Page'
import { CodeIcon } from '../components/icons'

export default function DevelopersScreen() {
  return (
    <Page title="Developers">
      <EmptyState
        icon={<CodeIcon size={18} />}
        title="Developer tools aren’t connected yet"
        description="API keys, webhooks and the CLI arrive in a later build."
      />
    </Page>
  )
}
