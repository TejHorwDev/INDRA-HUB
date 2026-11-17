import type { Metadata } from 'next'
import Link from 'next/link'
import Reveal from '@/components/Reveal'
import { db } from '@/lib/db'
import { day } from '@/lib/format'
import { business } from '@/lib/settings'
import type { Project } from '@/lib/types'

export const dynamic = 'force-dynamic'

/*
 * The shopfront.
 *
 * The first thing a stranger sees, and the only page in the product that has to sell something
 * without saying much: one line that says what this is, the newest delivered piece given room
 * to breathe, then the rest of the work as tiles. Everything on it comes from the rows the
 * dashboard writes — mark work delivered and it appears here, no deploy.
 *
 * What is deliberately absent: client names, amounts, receipts, and any number that is not
 * about the work itself. A visitor came to see what was built.
 *
 * A sleeping database degrades to the hero rather than a stack trace.
 */

export async function generateMetadata(): Promise<Metadata> {
  try {
    const { name, contact } = await business()
    const brand = name || 'Ledger'
    return {
      title: brand,
      description: contact || 'Apps, panels and systems, built to order.',
      openGraph: { title: brand, description: contact || 'Apps, panels and systems, built to order.' }
    }
  } catch {
    return { title: 'Ledger' }
  }
}

export default async function Home() {
  let work: Project[] = []
  let brand = { name: '', contact: '' }

  try {
    const [projects, settings] = await Promise.all([
      db.select<Project>('svc_projects', 'select=*&status=eq.delivered&order=delivered_on.desc'),
      business()
    ])
    work = projects
    brand = settings
  } catch {
    work = []
  }

  const name = brand.name || 'Ledger'
  const [featured, ...rest] = work
  const tileWork = featured ? rest : work
  const since = work.length
    ? Math.min(...work.map((project) => Number((project.delivered_on ?? '').slice(0, 4)) || new Date().getFullYear()))
    : null

  return (
    <>
      <Reveal />

      <nav className="snav">
        <div className="wrap snav-in">
          <Link href="/" className="brand">
            {name}
          </Link>
          <div className="links">
            <a href="#work">Work</a>
            <a href="#contact">Contact</a>
            <Link href="/login" className="who">
              Sign in
            </Link>
          </div>
        </div>
      </nav>

      <main className="wrap">
        <section className="hero" data-reveal>
          <span className="kicker">{name} · built to order</span>
          <h1>
            Software that carries
            <br />
            its own weight.
          </h1>
          <p className="lead">
            {brand.contact
              ? `${brand.contact} — apps, panels and the systems behind them, made for one business at a time.`
              : 'Apps, panels and the systems behind them — made for one business at a time, and finished before it ships.'}
          </p>
          <div className="acts">
            <a href="#work" className="pill-btn">
              See the work
            </a>
            <a href="#contact" className="pill-btn ghosty">
              Talk about yours
            </a>
          </div>
        </section>

        {featured ? (
          <section className="feature" data-reveal>
            <div>
              <span className="tag">Latest · {featured.kind}</span>
              <h2>{featured.title}</h2>
              {featured.summary ? <p>{featured.summary}</p> : null}
              {featured.url ? (
                <a className="more" href={featured.url} target="_blank" rel="noreferrer">
                  Look at it ↗
                </a>
              ) : null}
              <div className="meta" style={{ marginTop: 26, fontSize: 11.5, letterSpacing: '0.14em', color: 'var(--ink-3)', textTransform: 'uppercase' }}>
                Delivered {featured.delivered_on ? day(featured.delivered_on) : ''}
              </div>
            </div>
            <Art project={featured} />
          </section>
        ) : null}

        <section className="shelf" id="work" data-reveal>
          <div className="shelf-head">
            <h2>{featured ? 'More work' : 'Work'}</h2>
            <span>{`${work.length} ${work.length === 1 ? 'project' : 'projects'}`}</span>
          </div>

          {work.length === 0 ? (
            <p className="empty">Nothing published yet — delivered work appears here.</p>
          ) : (
            <div className="tiles">
              {tileWork.map((project) => (
                <article key={project.id} className="tile">
                  <Art project={project} />
                  <div>
                    <h3>{project.title}</h3>
                    {project.summary ? <p className="line">{project.summary}</p> : null}
                  </div>
                  <div className="meta">
                    <span>
                      {project.kind} · {project.delivered_on ? day(project.delivered_on) : 'delivered'}
                    </span>
                    {project.url ? (
                      <a href={project.url} target="_blank" rel="noreferrer">
                        Open ↗
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="numbers" data-reveal>
          <div>
            <strong>{work.length}</strong>
            <small>Delivered</small>
          </div>
          <div>
            <strong>{new Set(work.map((project) => project.client_id)).size || 0}</strong>
            <small>Businesses served</small>
          </div>
          <div>
            <strong>{since ?? '—'}</strong>
            <small>Building since</small>
          </div>
        </section>

        <section className="cta" id="contact" data-reveal>
          <h2>Have something that needs to exist?</h2>
          <p>
            {brand.contact
              ? brand.contact
              : 'Tell me what it has to do, and I will tell you what it takes to build it.'}
          </p>
          {brand.contact ? (
            <a className="pill-btn" href={`mailto:${brand.contact.split(/[·|,]/)[0].trim()}`}>
              Get in touch
            </a>
          ) : null}
        </section>

        <footer className="foot">
          <span>{name}</span>
          <span>{brand.contact}</span>
        </footer>
      </main>
    </>
  )
}

/**
 * A cover if the work has one, and a deliberate panel if it does not.
 *
 * The fallback is not a placeholder grey box: it is the project's own initial, lit from one
 * corner. Work without a screenshot should still look like it was placed there on purpose.
 */
function Art({ project }: { project: Project }) {
  const initial = project.title.trim().charAt(0).toUpperCase()

  return (
    <div className="art">
      {project.cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={project.cover} alt={project.title} loading="lazy" />
      ) : (
        <div className="fallback" aria-hidden="true">
          {initial}
        </div>
      )}
    </div>
  )
}
