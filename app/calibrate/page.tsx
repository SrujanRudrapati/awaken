import type { Metadata } from 'next';
import { CalibrateClient } from './CalibrateClient';

export const metadata: Metadata = {
  title: 'Calibration',
  description: 'Four short tests. Iris sets your starting rank.',
};

export default function CalibratePage() {
  return <CalibrateClient />;
}
