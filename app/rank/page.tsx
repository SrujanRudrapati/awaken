import type { Metadata } from 'next';
import { RankClient } from './RankClient';

export const metadata: Metadata = {
  title: 'Rank',
  description: 'Your rank, E to A. Earned by growth.',
};

export default function RankPage() {
  return <RankClient />;
}
