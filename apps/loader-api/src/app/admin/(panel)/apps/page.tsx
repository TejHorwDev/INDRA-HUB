import Products from '@/components/Products'

export const dynamic = 'force-dynamic'

export default function AppsPage(): React.JSX.Element {
  return (
    <div className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">
            <span className="dot" data-tone="off" />
            Catalogue
          </p>
          <h1>Products</h1>
          <p className="lede">
            What the loader shows. A product appears once it has a name and an installer.
          </p>
        </div>
      </section>
      <Products />
    </div>
  )
}
