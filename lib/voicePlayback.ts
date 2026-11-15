/**
 * Browser side of the System voice, for the web app to call on each `voice` SSE event:
 * plays the Polly MP3 when the event has `audioUrl`, otherwise (or if playback fails, e.g.
 * autoplay blocked) speaks the text with speechSynthesis in a low, slow voice.
 * Safe to import anywhere: does nothing outside a browser.
 */
export interface VoiceLine {
  text: string;
  audioUrl?: string;
}

const FALLBACK_PITCH = 0.6;
const FALLBACK_RATE = 0.9;

export function speakWithBrowser(text: string): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.pitch = FALLBACK_PITCH;
  utterance.rate = FALLBACK_RATE;
  window.speechSynthesis.cancel(); // the newest System line wins
  window.speechSynthesis.speak(utterance);
  return true;
}

/** Resolves to how the line was voiced. */
export async function playVoice(line: VoiceLine): Promise<'audio' | 'speech' | 'none'> {
  if (typeof window === 'undefined') return 'none';
  if (line.audioUrl) {
    try {
      await new Audio(line.audioUrl).play();
      return 'audio';
    } catch {
      // autoplay blocked or file missing → speak it instead
    }
  }
  return speakWithBrowser(line.text) ? 'speech' : 'none';
}
