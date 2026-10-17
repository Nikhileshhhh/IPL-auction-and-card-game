/** Low-data mode asks for the smallest stored variant (320 px wide). */
export function lowDataSrc(src: string): string {
  return src.replace(/^(\/api\/media\/[0-9a-f-]{36})\/(?:640|960)$/, '$1/320');
}
