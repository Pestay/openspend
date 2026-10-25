import { addDays, todayInChile } from '../db'
import { AppError } from '../errors'

// Dólar observado del Banco Central, vía la API pública https://mindicador.cl
const MINDICADOR_URL = 'https://mindicador.cl/api/dolar'
// Máximo de días hacia atrás para buscar un valor (fines de semana largos, feriados).
const MAX_LOOKBACK_DAYS = 7

interface MindicadorResponse {
  serie: { fecha: string; valor: number }[]
}

async function fetchYear(year: number): Promise<{ date: string; rate: number }[]> {
  const res = await fetch(`${MINDICADOR_URL}/${year}`, {
    headers: { 'User-Agent': 'openspend' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`mindicador.cl respondió ${res.status} para el año ${year}`)
  const data = (await res.json()) as MindicadorResponse
  // `fecha` viene como "2026-10-23T03:00:00.000Z" (medianoche en Chile), así que los
  // primeros 10 caracteres son la fecha local.
  return data.serie.map((s) => ({ date: s.fecha.slice(0, 10), rate: s.valor }))
}

async function readCached(d1: D1Database, from: string, to: string): Promise<Map<string, number>> {
  const { results } = await d1
    .prepare(`SELECT date, clp_per_unit AS rate FROM exchange_rates WHERE currency = 'USD' AND date BETWEEN ? AND ?`)
    .bind(from, to)
    .all<{ date: string; rate: number }>()
  return new Map(results.map((r) => [r.date, r.rate]))
}

async function writeCache(d1: D1Database, rows: { date: string; rate: number }[]) {
  if (rows.length === 0) return
  await d1
    .prepare(
      `INSERT OR IGNORE INTO exchange_rates (currency, date, clp_per_unit)
       SELECT 'USD', json_extract(value, '$.date'), json_extract(value, '$.rate') FROM json_each(?)`,
    )
    .bind(JSON.stringify(rows))
    .run()
}

function latestOnOrBefore(cache: Map<string, number>, date: string): number | undefined {
  for (let i = 0; i <= MAX_LOOKBACK_DAYS; i++) {
    const rate = cache.get(addDays(date, -i))
    if (rate !== undefined) return rate
  }
  return undefined
}

/**
 * Devuelve cuántos CLP vale 1 USD para cada fecha pedida.
 * Usa la caché en D1 y, si falta algo, descarga el año completo desde mindicador.cl
 * (una sola petición por año) para que las importaciones masivas sean rápidas.
 */
export async function getUsdClpRates(d1: D1Database, dates: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(dates)].sort()
  const result = new Map<string, number>()
  if (unique.length === 0) return result

  const from = addDays(unique[0], -MAX_LOOKBACK_DAYS)
  const to = unique[unique.length - 1]
  let cache = await readCached(d1, from, to)

  const missing = unique.filter((d) => !cache.has(d))
  if (missing.length > 0) {
    const years = new Set<number>()
    for (const d of missing) {
      years.add(Number(d.slice(0, 4)))
      // Los primeros días de enero pueden necesitar el último valor del año anterior.
      years.add(Number(addDays(d, -MAX_LOOKBACK_DAYS).slice(0, 4)))
    }
    const fetched = (await Promise.all([...years].map(fetchYear))).flat()
    await writeCache(d1, fetched)
    cache = await readCached(d1, from, to)
  }

  const today = todayInChile()
  const fills: { date: string; rate: number }[] = []
  for (const date of unique) {
    const rate = cache.get(date) ?? latestOnOrBefore(cache, date)
    if (rate === undefined) throw new AppError(`No hay dólar observado disponible para ${date}`)
    result.set(date, rate)
    // Guardamos fines de semana y feriados pasados con el valor vigente para no volver
    // a descargar el año. Hoy y fechas futuras no, porque el valor aún podría publicarse.
    if (!cache.has(date) && date < today) fills.push({ date, rate })
  }
  await writeCache(d1, fills)
  return result
}
