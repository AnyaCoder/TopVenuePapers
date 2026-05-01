export function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u2019'`]/g, '')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenize(value: string) {
  return normalizeText(value).split(' ').filter(Boolean)
}
