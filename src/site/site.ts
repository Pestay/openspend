// Comportamiento mínimo de las páginas públicas estáticas (sin React).

// La URL del MCP depende del dominio donde esté desplegado OpenSpend.
const mcpUrl = `${window.location.origin}/mcp`
for (const el of document.querySelectorAll<HTMLElement>('[data-mcp-url]')) {
  el.textContent = (el.dataset.template ?? '{url}').replaceAll('{url}', mcpUrl)
}

// Botones "Copiar": copian el texto del elemento indicado en data-copy.
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  button.addEventListener('click', async () => {
    const source = document.getElementById(button.dataset.copy!)
    if (!source?.textContent) return
    await navigator.clipboard.writeText(source.textContent)
    const label = button.textContent
    button.textContent = 'Copiado ✓'
    setTimeout(() => (button.textContent = label), 1500)
  })
}
