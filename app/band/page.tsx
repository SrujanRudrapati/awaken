import type { Metadata } from 'next';
import { BandClient } from './BandClient';

export const metadata: Metadata = {
  title: 'Band',
  description: 'The phone on your arm. Iris counts every rep.',
};

export default function BandPage() {
  return <BandClient />;
}
