/**
 * Theme handling for the renderer.
 *
 * The choice lives in localStorage, not in app settings — settings are backed by
 * the OS keychain and a write there would touch stored credentials. A window
 * appearance toggle has no business going near them.
 */

export type ThemePref = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'serpent.theme';

/** Window background per theme — must track --bg-primary in styles.css. */
const CHROME: Record<ResolvedTheme, { bg: string; symbol: string }> = {
  dark: { bg: '#0f1117', symbol: '#74b9ff' },
  light: { bg: '#ffffff', symbol: '#2563eb' },
};

export function getThemePref(): ThemePref {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

export function systemTheme(): ResolvedTheme {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  return pref === 'system' ? systemTheme() : pref;
}

/**
 * Paint the theme: stamp <html data-theme>, then tell main to repaint the
 * native window chrome (the frameless title bar overlay keeps its own colours).
 */
export function applyTheme(pref: ThemePref): ResolvedTheme {
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme', resolved);
  localStorage.setItem(STORAGE_KEY, pref);
  window.api?.setTitleBarTheme?.({ ...CHROME[resolved], theme: resolved });
  return resolved;
}

/**
 * Re-apply on OS theme change, but only while the user is on 'system'.
 * Returns an unsubscribe function.
 */
export function watchSystemTheme(onChange: (resolved: ResolvedTheme) => void): () => void {
  const mq = window.matchMedia?.('(prefers-color-scheme: light)');
  if (!mq) return () => {};
  const handler = () => {
    if (getThemePref() !== 'system') return;
    onChange(applyTheme('system'));
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
