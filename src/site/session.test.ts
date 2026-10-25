import { describe, expect, it } from 'vitest'
import { hasSession } from './session'

const respond = (status: number) => async () => new Response('{}', { status })

describe('sesión en las páginas públicas', () => {
  it('detecta la sesión preguntando a /api/me', async () => {
    let asked = ''
    const fetchFn = async (input: RequestInfo | URL) => {
      asked = String(input)
      return new Response('{}', { status: 200 })
    }
    expect(await hasSession(fetchFn)).toBe(true)
    expect(asked).toBe('/api/me')
  })

  it('sin sesión o con error de red se muestra como visitante', async () => {
    expect(await hasSession(respond(401))).toBe(false)
    expect(await hasSession(respond(500))).toBe(false)
    expect(await hasSession(async () => Promise.reject(new Error('offline')))).toBe(false)
  })
})
