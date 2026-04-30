import { nextTick, onBeforeUnmount, onMounted, ref, watch, type ComputedRef } from 'vue'

export function useScrollSpy(sectionIds: ComputedRef<string[]>) {
  const activeId = ref(sectionIds.value[0] ?? '')
  let observer: IntersectionObserver | null = null

  const disconnect = () => {
    observer?.disconnect()
    observer = null
  }

  const connect = async () => {
    await nextTick()
    disconnect()

    observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)

        if (visible[0]) {
          activeId.value = visible[0].target.id
        }
      },
      {
        rootMargin: '-15% 0px -60% 0px',
        threshold: [0.15, 0.35, 0.6],
      },
    )

    sectionIds.value.forEach((id) => {
      const element = document.getElementById(id)
      if (element) {
        observer?.observe(element)
      }
    })

    if (sectionIds.value[0]) {
      activeId.value = sectionIds.value[0]
    }
  }

  const jumpTo = (id: string) => {
    const target = document.getElementById(id)
    if (!target) {
      return
    }

    activeId.value = id
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  onMounted(() => {
    watch(sectionIds, () => void connect(), { immediate: true })
  })

  onBeforeUnmount(disconnect)

  return {
    activeId,
    jumpTo,
  }
}
