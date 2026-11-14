/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // Uploads are presigned and go straight to the bucket, so the API only ever
    // handles JSON. This is a ceiling for the local driver, not a normal path.
    serverActions: { bodySizeLimit: '8mb' }
  }
}

export default nextConfig
