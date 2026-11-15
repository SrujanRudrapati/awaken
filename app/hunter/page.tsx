import type { Metadata, Viewport } from 'next';
import { HunterClient } from './HunterClient';

export const metadata: Metadata = {
  title: 'Oath — Armband',
  description: 'Phone armband sensor and Iris window',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#05070D',
};

export default function HunterPage() {
  return <HunterClient />;
}
