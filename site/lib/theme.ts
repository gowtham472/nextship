/**
 * Theme resolution, shared by the inline boot script and the toggle so the two
 * can never disagree about what "system" means.
 *
 * Author: Gowtham
 */

export type Theme = 'light' | 'dark' | 'system'

export const THEME_STORAGE_KEY = 'nextship-theme'

/**
 * Applied to the document before the first paint.
 *
 * Written as a string rather than imported, because a module would load after
 * the document has already painted the wrong theme. It fails silently: a
 * browser with site data blocked throws on localStorage, and a themeless page
 * is a far better outcome than a blank one.
 */
export const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  } catch (e) {}
})();
`.trim()

/** Reads the stored preference, treating anything unrecognised as "system". */
export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

/**
 * Writes the preference and applies it.
 *
 * "system" removes the attribute rather than resolving it to a colour, so the
 * page keeps following the operating system when the visitor changes it later.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement

  // Colour transitions would render the switch as a fade through the wrong
  // palette. Suppressed for one frame, then restored.
  root.classList.add('theme-changing')

  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)

  try {
    if (theme === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // A browser that blocks site data still gets the theme it asked for; it
    // just will not be remembered. That is worth failing quietly for.
  }

  window.setTimeout(() => root.classList.remove('theme-changing'), 0)
}
