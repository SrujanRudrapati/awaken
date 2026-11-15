/** Who is signed in on this device: `?player=<id>` wins, else the id remembered in localStorage. */
const STORAGE_KEY = 'awaken.playerId'; // storage key kept from the first build so phones stay signed in

export function rememberedId(): string | null {
  if (typeof window === 'undefined') return null;
  const fromUrl = new URLSearchParams(window.location.search).get('player');
  try {
    if (fromUrl) window.localStorage.setItem(STORAGE_KEY, fromUrl); // links between screens carry no query
    return fromUrl ?? window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return fromUrl;
  }
}

export function rememberId(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // private mode: the URL still works
  }
}

export function forgetId(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing stored
  }
}
