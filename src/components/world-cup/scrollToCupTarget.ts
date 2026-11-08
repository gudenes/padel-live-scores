export function scrollToCupTarget(element: HTMLElement | null) {
  if (element) element.scrollIntoView({ block: 'center' })
}
