// Comportamiento mínimo de las páginas públicas estáticas (sin React).
import { EXAMPLES, fillTemplate, GUIDES, mcpUrl as mcpUrlFor, rich } from '../shared/connect-guide'
import { hasSession } from './session'

// La URL del MCP depende del dominio donde esté desplegado OpenSpend.
const mcpUrl = mcpUrlFor(window.location.origin)

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// Texto con **negritas** y `código`, armado con nodos (nunca innerHTML).
function richText(parent: HTMLElement, text: string) {
  for (const segment of rich(text)) {
    if (segment.bold) parent.append(el('strong', '', segment.text))
    else if (segment.code) parent.append(el('code', 'rounded bg-slate-100 px-1', segment.text))
    else parent.append(segment.text)
  }
}

for (const container of document.querySelectorAll<HTMLElement>('[data-guides]')) {
  for (const guide of GUIDES) {
    const section = el('section', 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm')
    const title = el('h2', 'font-semibold', guide.title)
    if (guide.subtitle) title.append(' ', el('span', 'font-normal text-slate-400', `· ${guide.subtitle}`))
    const steps = el('ol', 'mt-3 list-inside list-decimal space-y-2 text-sm text-slate-700')
    for (const step of guide.steps) richText(steps.appendChild(el('li')), step)
    section.append(title, steps)
    if (guide.snippet) {
      const id = `snippet-${guide.id}`
      const row = el('div', 'my-2 flex items-start gap-2')
      const code = guide.snippet.block
        ? el('pre', 'min-w-0 flex-1 overflow-x-auto rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs')
        : el('code', 'min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs')
      code.id = id
      code.textContent = fillTemplate(guide.snippet.template, mcpUrl)
      const button = el('button', 'rounded border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50', 'Copiar')
      button.dataset.copy = id
      row.append(code, button)
      section.append(row)
    }
    if (guide.after) richText(section.appendChild(el('p', 'text-sm text-slate-700')), guide.after)
    if (guide.note) section.append(el('p', 'text-xs text-slate-400', guide.note))
    container.append(section)
  }
}

for (const list of document.querySelectorAll<HTMLElement>('[data-examples]')) {
  for (const example of EXAMPLES) list.append(el('li', 'rounded-full bg-emerald-50 px-3 py-1 text-emerald-800', `“${example}”`))
}

for (const node of document.querySelectorAll<HTMLElement>('[data-mcp-url]')) {
  node.textContent = fillTemplate(node.dataset.template ?? '{url}', mcpUrl)
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

// Con sesión iniciada, los links llevan de vuelta a la app en vez de pedir entrar de nuevo.
void hasSession().then((signedIn) => {
  if (!signedIn) return
  for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-signed-in-href]')) {
    link.href = link.dataset.signedInHref!
  }
  for (const link of document.querySelectorAll<HTMLElement>('[data-signed-in-label]')) {
    link.textContent = link.dataset.signedInLabel!
  }
})
