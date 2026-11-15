import type { Metadata } from 'next';
import { TodayClient } from './TodayClient';

export const metadata: Metadata = {
  title: 'Today',
  description: "Today's vows, watched by Iris.",
};

export default function TodayPage() {
  return <TodayClient />;
}
