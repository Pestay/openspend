/**
 * Parser CSV (RFC 4180): campos entre comillas con comas, comillas escapadas ("") y saltos
 * de línea dentro de una nota. Devuelve una fila por objeto, usando el encabezado.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const input = text.replace(/^﻿/, '')

  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  const [header, ...data] = rows.filter((r) => r.some((cell) => cell.trim() !== ''))
  if (!header) return []
  return data.map((r) => Object.fromEntries(header.map((name, i) => [name.trim(), (r[i] ?? '').trim()])))
}
