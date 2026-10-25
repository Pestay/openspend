import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import type { ZodType } from 'zod'

// zValidator con errores legibles: "transactions.0.date: Fecha en formato YYYY-MM-DD"
export const validate = <T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const error = result.error.issues.map((i) => `${i.path.join('.') || target}: ${i.message}`).join('; ')
      return c.json({ error }, 400)
    }
  })
