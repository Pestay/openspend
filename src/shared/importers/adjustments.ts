// Algunas apps (o usuarios) registran las correcciones de saldo como una categoría más.
// No se marcan solas: solo se sugieren al usuario cuando el nombre lo parece.
const ADJUSTMENT_NAME = /\b(ajustes?|adjust(ment)?s?|correcci[oó]n(es)?|conciliaci[oó]n(es)?|reconcil(iation|e)?s?)\b/i

export function looksLikeAdjustment(categoryName: string): boolean {
  return ADJUSTMENT_NAME.test(categoryName)
}
