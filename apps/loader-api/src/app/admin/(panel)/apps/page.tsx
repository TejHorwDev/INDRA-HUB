import Products from '@/components/Products'

export const dynamic = 'force-dynamic'

export default function AppsPage(): React.JSX.Element {
  return (
    <>
      <h1>Products</h1>
      <p className="lede">
        What the loader shows. A product appears in the app as soon as it has a name; it can be
        downloaded once an installer has been uploaded and locked without being removed.
      </p>
      <Products />
    </>
  )
}
