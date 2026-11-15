import type { Metadata } from 'next';
import { ReckoningClient } from './ReckoningClient';

export const metadata: Metadata = {
  title: 'The Reckoning',
  description: 'Break a vow, face it.',
};

export default function ReckoningPage() {
  return <ReckoningClient />;
}
