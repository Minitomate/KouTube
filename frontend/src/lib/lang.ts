/** Bare language codes → country names via Intl (no dep). Rich labels pass through. */
export function languageName(code: string): string | undefined {
  if (!code || code === 'und') return undefined;
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code);
    if (!name || name === code) return undefined;
    return name;
  } catch {
    return undefined;
  }
}

/** Display label: bare code becomes "Name (code)"; existing labels untouched. */
export function displayLabel(id: string, label: string): string {
  const code = id.startsWith('auto:') ? id.slice(5) : id;
  if (label && label !== id && label !== code) return label;
  const name = languageName(code);
  return name ? `${name} (${code})` : label;
}

/** Badge detail for a selected caption id: "en (auto)" for auto tracks. */
export function captionLabel(id: string): string {
  return id.startsWith('auto:') ? `${id.slice(5)} (auto)` : id;
}
