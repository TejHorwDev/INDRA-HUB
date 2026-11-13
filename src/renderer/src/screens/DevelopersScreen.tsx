import Page from '../components/Page'

/*
 * Developers.
 *
 * Nothing is connected here yet, and the screen says exactly that in the space
 * one sentence needs. An empty state with a 44px icon block and a centred hero
 * would make an unavailable surface look like the point of the app; a quiet
 * panel with a status word is the honest shape for "not in this build".
 */
export default function DevelopersScreen() {
  return (
    <Page
      eyebrow="Workspace"
      title="Developers"
      description="The surface for building on INDRA HUB."
    >
      <section className="dev-panel" aria-labelledby="dev-panel-title">
        <div className="dev-panel-head">
          <h2 id="dev-panel-title" className="dev-panel-title">
            Developer tools aren’t connected yet
          </h2>
          <span className="badge">Later build</span>
        </div>
        <p className="dev-panel-body">
          API keys, webhooks and the command line arrive in a later build. There is nothing to
          configure on this PC, and no key to keep.
        </p>
      </section>
    </Page>
  )
}
