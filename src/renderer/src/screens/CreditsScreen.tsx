import EmptyState from '../components/EmptyState'
import Page from '../components/Page'
import { InfoIcon, SparkIcon } from '../components/icons'

export default function CreditsScreen() {
  return (
    <Page title="Credits">
      <div className="credits-balance">
        <div>
          <p className="micro-label">Balance</p>
          <p className="mt-3 flex items-baseline gap-2">
            <span className="text-4xl leading-none font-medium tracking-[-0.04em] text-[var(--ink)]">
              0
            </span>
            <span className="text-sm text-[var(--ink-tertiary)]">credits</span>
          </p>
        </div>
      </div>

      <div className="notice mt-4 max-w-[520px] items-start">
        <InfoIcon />
        <span>
          Credits and usage tracking aren’t connected yet. Nothing is earned or spent in this build.
        </span>
      </div>

      <section className="credits-panel mt-4" aria-label="Usage history">
        <div className="panel-head">Usage history</div>
        <EmptyState
          variant="panel"
          icon={<SparkIcon size={16} />}
          title="No usage yet"
          description="Activity will appear here once usage tracking is connected."
        />
      </section>
    </Page>
  )
}
