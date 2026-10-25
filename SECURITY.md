# Política de seguridad

OpenSpend maneja datos financieros personales, así que tomamos en serio cualquier reporte de seguridad.

## Versiones soportadas

Solo la **última release** recibe correcciones de seguridad. La instancia oficial
(`openspend.elguet5.workers.dev`) siempre corre la última versión publicada.

## Cómo reportar una vulnerabilidad

**No abras un issue público.** Usa el reporte privado de GitHub:

1. Ve a la pestaña [**Security → Report a vulnerability**](https://github.com/carloxhunter/openspend/security/advisories/new).
2. Describe el problema, cómo reproducirlo y su impacto.

Recibirás una respuesta inicial en un plazo de **7 días**. Si el reporte se confirma, coordinaremos la corrección
y la fecha de divulgación contigo, y te daremos crédito en el aviso si lo deseas.

## Alcance

Nos interesan especialmente:

- Acceso a datos de otro usuario (lectura, edición o borrado).
- Saltarse la autenticación, la invitación de Auth0, la suspensión de usuarios o el consentimiento OAuth del MCP.
- Uso de tokens MCP fuera de su usuario o después de ser revocados.
- Filtración de secretos o credenciales.
- Inyección (SQL, XSS, comandos) en la API, el MCP o las páginas.

Fuera de alcance: ataques de denegación de servicio, ingeniería social, y problemas en servicios de terceros
(Cloudflare, Auth0, GitHub) que deben reportarse a ellos.

## Medidas existentes

- Escaneo de secretos (gitleaks en cada commit y PR, secret scanning y push protection de GitHub).
- Análisis estático con CodeQL; un PR con alertas de seguridad altas o críticas no se puede mergear.
- Dependabot para dependencias y alertas de vulnerabilidades.
- Tests de aislamiento entre usuarios en cada PR.
