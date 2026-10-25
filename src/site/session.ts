// Las páginas públicas preguntan si hay sesión para ofrecer "Ir a la app" en vez de "Entrar".
// La cookie de sesión es HttpOnly, así que la única forma de saberlo es consultar /api/me.
export async function hasSession(fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn('/api/me', { credentials: 'same-origin' })
    return res.ok
  } catch {
    return false
  }
}
