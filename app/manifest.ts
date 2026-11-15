import type { MetadataRoute } from 'next';

/** Home-screen app: opens straight on the band, full screen, on the OATH black. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'OATH',
    short_name: 'OATH',
    description: 'Make a vow. Keep it. Proven, not claimed.',
    start_url: '/band',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#05060A',
    theme_color: '#05060A',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
