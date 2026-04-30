import type { PaperRecord } from '../types/paper'

// Legacy export kept for older components. App.vue now lazy-loads
// /data/papers.catalog.json instead of bundling paper data into JS.
export const paperCatalog: PaperRecord[] = []
