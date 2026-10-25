import { describe, expect, it } from 'vitest'
import { fillTemplate, GUIDES, mcpUrl, rich } from './connect-guide'

describe('guía para conectar asistentes', () => {
  it('la URL del MCP depende del dominio donde está desplegado', () => {
    expect(mcpUrl('https://openspend.example')).toBe('https://openspend.example/mcp')
  })

  it('rellena las plantillas de configuración con la URL', () => {
    expect(fillTemplate('claude mcp add openspend {url}', 'https://x/mcp')).toBe('claude mcp add openspend https://x/mcp')
    expect(fillTemplate('{ "url": "{url}" }', 'https://x/mcp')).toBe('{ "url": "https://x/mcp" }')
  })

  it('separa texto, negritas y código para dibujarlos sin HTML', () => {
    expect(rich('Abre **Settings** y pega `OpenSpend`.')).toEqual([
      { text: 'Abre ' },
      { text: 'Settings', bold: true },
      { text: ' y pega ' },
      { text: 'OpenSpend', code: true },
      { text: '.' },
    ])
    expect(rich('sin marcas')).toEqual([{ text: 'sin marcas' }])
  })

  it('cubre los clientes principales y cada plantilla usa la URL', () => {
    expect(GUIDES.map((g) => g.id)).toEqual(['claude', 'chatgpt', 'claude-code', 'otros'])
    for (const guide of GUIDES) {
      expect(guide.steps.length).toBeGreaterThan(0)
      if (guide.snippet) expect(guide.snippet.template).toContain('{url}')
    }
  })
})
