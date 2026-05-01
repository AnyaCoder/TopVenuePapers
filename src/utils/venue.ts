import type { PaperCatalogIndexRecord, PaperRecord } from '../types/paper'

export function getVenueShortName(venue: string) {
  if (/unclassified/i.test(venue)) {
    return 'Unclassified'
  }

  const compact = venue.trim()
  const first = compact.split(/\s+/)[0]
  return first || compact
}

export function getVenueBadge(paper: Pick<PaperCatalogIndexRecord | PaperRecord, 'venue' | 'year'>) {
  return `${getVenueShortName(paper.venue)}-${paper.year}`
}
