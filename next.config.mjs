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
    serverComponentsExternalPackages: ['@sparticuz/chromium', 'puppeteer-core']
  }
};
export default nextConfig;
