// Error con mensaje pensado para el usuario (y para Claude vía MCP), mapeado a un status HTTP.
export class AppError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 = 400,
  ) {
    super(message)
  }
}
