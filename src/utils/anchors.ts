import type { CategoryKey } from '../types/paper'

export function toCategoryAnchor(category: CategoryKey) {
  return `category-${category}`
}
