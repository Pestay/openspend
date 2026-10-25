// Guía para conectar asistentes al MCP: la usan la página pública /conectar y la vista de la app,
// así los pasos se mantienen en un solo lugar. Las marcas **negrita** y `código` se dibujan sin HTML.

export type Segment = { text: string; bold?: true; code?: true }

export interface Guide {
  id: string
  title: string
  subtitle?: string
  steps: string[]
  snippet?: { template: string; block?: true }
  after?: string
  note?: string
}

export const mcpUrl = (origin: string) => `${origin}/mcp`

export const fillTemplate = (template: string, url: string) => template.replaceAll('{url}', url)

export function rich(text: string): Segment[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/)
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith('**')) return { text: part.slice(2, -2), bold: true }
      if (part.startsWith('`')) return { text: part.slice(1, -1), code: true }
      return { text: part }
    })
}

export const GUIDES: Guide[] = [
  {
    id: 'claude',
    title: 'Claude',
    subtitle: 'web, escritorio y celular',
    steps: [
      'Abre **Settings → Connectors** y elige **Add custom connector**.',
      'Nombre `OpenSpend` y pega la URL de arriba.',
      'Presiona **Connect**, inicia sesión y elige **Permitir**.',
      'Queda disponible también en la app del celular.',
    ],
  },
  {
    id: 'chatgpt',
    title: 'ChatGPT',
    steps: [
      'Abre **Settings → Apps & Connectors** (según tu plan, puede requerir activar el modo desarrollador).',
      'Crea un conector nuevo con la URL de arriba y autenticación OAuth.',
      'Inicia sesión y elige **Permitir**.',
    ],
  },
  {
    id: 'claude-code',
    title: 'Claude Code',
    steps: ['En la terminal:'],
    snippet: { template: 'claude mcp add --transport http --scope user openspend {url}' },
    after: 'Luego, dentro de Claude Code: `/mcp` → **openspend** → **Authenticate**.',
  },
  {
    id: 'otros',
    title: 'Otros',
    subtitle: 'Cursor, VS Code, Cline…',
    steps: ['Agrega un servidor MCP remoto (HTTP) con esta configuración:'],
    snippet: { template: '{ "mcpServers": { "openspend": { "url": "{url}" } } }', block: true },
    note: 'El cliente debe soportar login OAuth para servidores MCP.',
  },
]

export const EXAMPLES = [
  'Hoy gasté 8 lucas en almuerzo y 4.200 en uber',
  'Ayer pagué Netflix, 9,99 dólares',
  'Me llegó el sueldo: 1.800.000',
  '¿Cuánto llevo gastado este mes por categoría?',
  'El uber de ayer pásalo a Transporte',
]
