/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.carousell.com' },
      { protocol: 'https', hostname: '**.karousell.com' },
      { protocol: 'https', hostname: 'media.karousell.com' }
    ]
  },
  experimental: {
    serverComponentsExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
    outputFileTracingIncludes: {
      '/api/search': ['./node_modules/@sparticuz/chromium/bin/**/*'],
      '/api/search/route': ['./node_modules/@sparticuz/chromium/bin/**/*']
    }
  }
};
export default nextConfig;
