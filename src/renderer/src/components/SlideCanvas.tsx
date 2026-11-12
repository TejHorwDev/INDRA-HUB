import type { PresentationTheme, Slide } from '@shared/types'

interface SlideCanvasProps {
  slide: Slide
  theme: PresentationTheme
  index: number
  total: number
  /** Thumbnails skip interior numbering noise. */
  compact?: boolean
}

/**
 * Renders one slide from its real data. Sizes are container-query relative, so
 * the same markup is the editor canvas at any width and the thumbnail at 1/8th.
 */
export default function SlideCanvas({ slide, theme, index, total, compact }: SlideCanvasProps) {
  const bullets = slide.bullets ?? []
  const body = slide.body ?? ''

  return (
    <div className={`slide-canvas slide-theme--${theme}${compact ? ' slide-canvas--compact' : ''}`}>
      <div className="slide-body">
        {slide.layout === 'title' && (
          <div className="slide-layout slide-layout--title">
            <span className="slide-kicker">Presentation</span>
            <h1 className="slide-title">{slide.title || 'Untitled slide'}</h1>
            {body && <p className="slide-subtitle">{body}</p>}
          </div>
        )}

        {slide.layout === 'section' && (
          <div className="slide-layout slide-layout--section">
            <span className="slide-rule" />
            <h1 className="slide-title">{slide.title || 'Section'}</h1>
            {body && <p className="slide-subtitle">{body}</p>}
          </div>
        )}

        {slide.layout === 'text' && (
          <div className="slide-layout slide-layout--text">
            <h2 className="slide-heading">{slide.title}</h2>
            <p className="slide-paragraph">{body}</p>
            {bullets.length > 0 && (
              <ul className="slide-bullet-list">
                {bullets.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {slide.layout === 'bullets' && (
          <div className="slide-layout slide-layout--bullets">
            <h2 className="slide-heading">{slide.title}</h2>
            <ul className="slide-bullet-list">
              {bullets.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            {body && <p className="slide-caption">{body}</p>}
          </div>
        )}

        {slide.layout === 'process' && (
          <div className="slide-layout slide-layout--process">
            <h2 className="slide-heading">{slide.title}</h2>
            <ol className="slide-steps">
              {bullets.map((line, i) => (
                <li key={i}>
                  <span className="slide-step-index">{String(i + 1).padStart(2, '0')}</span>
                  <span className="slide-step-text">{line}</span>
                </li>
              ))}
            </ol>
            {body && <p className="slide-caption">{body}</p>}
          </div>
        )}

        {slide.layout === 'quote' && (
          <div className="slide-layout slide-layout--quote">
            <blockquote className="slide-quote">“{slide.quote || body || slide.title}”</blockquote>
            {slide.title && <p className="slide-attribution">— {slide.title}</p>}
          </div>
        )}

        {slide.layout === 'table' && (
          <div className="slide-layout slide-layout--table">
            <h2 className="slide-heading">{slide.title}</h2>
            <table className="slide-table">
              <thead>
                <tr>
                  {(slide.table?.headers ?? []).map((header, i) => (
                    <th key={i}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(slide.table?.rows ?? []).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {body && <p className="slide-caption">{body}</p>}
          </div>
        )}

        {slide.layout === 'image' && (
          <div className="slide-layout slide-layout--image">
            <div className="slide-image-text">
              <h2 className="slide-heading">{slide.title}</h2>
              {body && <p className="slide-paragraph">{body}</p>}
            </div>
            {slide.image?.src ? (
              <img className="slide-image" src={slide.image.src} alt={slide.image.alt} />
            ) : (
              <div className="slide-image slide-image--empty">Image</div>
            )}
          </div>
        )}

        {slide.layout === 'closing' && (
          <div className="slide-layout slide-layout--closing">
            <h1 className="slide-title">{slide.title || 'Thank you'}</h1>
            {body && <p className="slide-subtitle">{body}</p>}
            {bullets.length > 0 && (
              <ul className="slide-bullet-list">
                {bullets.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {!compact && (
        <div className="slide-footer">
          <span className="slide-footer-mark">INDRA HUB</span>
          <span className="slide-footer-page">
            {index + 1} / {total}
          </span>
        </div>
      )}
    </div>
  )
}
