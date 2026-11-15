/** Offline fallback questions for the focus quiz (used when Haiku is unreachable). */
import type { QuizQuestion } from './quiz';

export const FALLBACK_QUESTIONS: readonly QuizQuestion[] = [
  { question: 'Which organ pumps blood through the human body?', options: ['Lungs', 'Heart', 'Liver', 'Kidney'], answerIndex: 1 },
  { question: 'What is 12 × 12?', options: ['124', '142', '144', '154'], answerIndex: 2 },
  { question: 'Which planet is closest to the Sun?', options: ['Venus', 'Mars', 'Mercury', 'Earth'], answerIndex: 2 },
  { question: 'Water boils at sea level at what temperature (°C)?', options: ['90', '100', '110', '120'], answerIndex: 1 },
  { question: 'Which gas do plants absorb for photosynthesis?', options: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Helium'], answerIndex: 2 },
  { question: 'How many minutes are in three hours?', options: ['120', '160', '180', '210'], answerIndex: 2 },
  { question: 'Which muscle group do squats mainly train?', options: ['Biceps', 'Legs', 'Neck', 'Forearms'], answerIndex: 1 },
  { question: 'What is the square root of 81?', options: ['7', '8', '9', '10'], answerIndex: 2 },
  { question: 'Which is the largest ocean on Earth?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], answerIndex: 3 },
];
