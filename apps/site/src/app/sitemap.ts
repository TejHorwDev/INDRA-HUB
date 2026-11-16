import type { MetadataRoute } from 'next'
import { getProducts, SITE_URL } from '@/lib/catalogue'

/*
 * The sitemap is the catalogue.
 *
 * Written from the same list the page is built from, so a product is in the sitemap the
 * moment it is in the grid, and a product taken down leaves both at the same time.
 */
export const revalidate = 10

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await getProducts()
  const now = new Date()

  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    ...products.map((product) => ({
      url: `${SITE_URL}/p/${product.slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.8
    }))
  ]
}
