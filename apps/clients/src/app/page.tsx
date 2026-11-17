import Link from 'next/link'
import { db } from '@/lib/db'
import { day } from '@/lib/format'
import { business } from '@/lib/settings'
import type { Project } from '@/lib/types'

export const dynamic = 'force-dynamic'

/*
 * The public face of the work.
 *
 * Everything on this page comes from the same rows the dashboard writes: mark a piece of work
 * delivered and it appears here, no deploy. Nothing private crosses over — no client names, no
 * amounts, no receipts. A visitor sees what was built and, if it was given a link, where it
 * lives.
 *
 * A database that is asleep or unreachable is not a reason to show a stack trace to somebody
 * who came to look at the work, so the page degrades to the hero and says nothing else.
 */
export default async function Home() {
  let work: Project[] = []
  let brand = { name: 'Ledger', contact: '' }

  try {
    const [projects, settings] = await Promise.all([
      db.select<Project>('svc_projects', "select=*&status=eq.delivered&order=delivered_on.desc"),
      business()
    ])
    work = projects
    brand = settings
  } catch {
    work = []
  }

  const name = brand.name || 'Ledger'

  return (
    <>
      <header className="bar">
        <div className="wrap bar-in">
          <span className="mark">
            <b>{name}</b>
            <span>built to order</span>
          </span>
          <nav>
            <Link href="/login">Sign in</Link>
          </nav>
        </div>
      </header>

      <main className="wrap landing">
        <section className="hero">
          <span className="kicker">{name}</span>
          <h1>
            Apps, panels and systems,
            <br />
            built for the way people actually work.
          </h1>
          <p>
            {brand.contact
              ? brand.contact
              : 'Software made to order — the panel, the app, and everything behind it.'}
          </p>
        </section>

        <section className="work">
          <div className="work-head">
            <h2>Work</h2>
            <span className="sub">
              {work.length} {work.length === 1 ? 'project' : 'projects'}
            </span>
          </div>

          {work.length === 0 ? (
            <p className="empty">Nothing published yet — delivered work appears here.</p>
          ) : (
            <div className="workgrid">
              {work.map((project, index) => (
                <article key={project.id} className="workcard">
                  <div className="workcard-top">
                    <span className="tag">{project.kind}</span>
                    <span className="num-index">{String(index + 1).padStart(2, '0')}</span>
                  </div>

                  <h3>{project.title}</h3>
                  {project.summary ? <p>{project.summary}</p> : null}

                  <footer>
                    <span>{project.delivered_on ? day(project.delivered_on) : 'Delivered'}</span>
                    {project.url ? (
                      <a href={project.url} target="_blank" rel="noreferrer" className="open">
                        Open ↗
                      </a>
                    ) : null}
                  </footer>
                </article>
              ))}
            </div>
          )}
        </section>

        <footer className="landing-foot">
          <span>{name}</span>
          <span>{brand.contact}</span>
        </footer>
      </main>
    </>
  )
}
