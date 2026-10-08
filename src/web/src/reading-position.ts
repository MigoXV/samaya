// Capture the reader before older content is prepended, after its request resolves.
export function preserveReadingPosition(node: HTMLElement | null) {
  node
    ?.closest(".detail-scroll")
    ?.dispatchEvent(new Event("samaya:prepend-history"));
}

export function preserveMessagePosition(node: HTMLElement | null) {
  node
    ?.closest(".detail-scroll")
    ?.dispatchEvent(new CustomEvent("samaya:resize-message", { detail: node }));
}
