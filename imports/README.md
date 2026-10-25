# Importar datos históricos

Esta carpeta es el lugar para dejar los archivos que quieres cargar en OpenSpend: exports de otra app de
finanzas, cartolas del banco o de la tarjeta.

> **Todo lo que pongas aquí está ignorado por git** (ver `.gitignore`); solo esta guía se versiona. Aun así,
> no copies estos archivos a otras carpetas del repo.

## Estructura: una subcarpeta por origen

```
imports/
  README.md      ← esta guía (lo único versionado)
  spendee/       ← exports JSON de Spendee
```

Cada subcarpeta corresponde a un **adaptador** del importador (`src/worker/importers/<origen>.ts`), que sabe
interpretar el formato de ese origen y convertirlo en movimientos de OpenSpend. Para soportar otra app se agrega
un adaptador y su subcarpeta.

## Cómo se cargan

1. Deja los archivos en la subcarpeta de su origen (por ejemplo `imports/spendee/`).
2. En el dashboard, abre **Importar** (`/app/importar`), elige el origen y selecciona los archivos.
3. Revisa la **vista previa**: cantidad de movimientos, rango de fechas, cómo se asignan cuentas y categorías y
   cuáles parecen duplicados. Nada se guarda todavía.
4. Confirma. La carga queda como un **lote de importación** que puedes revertir completo si algo salió mal.

Las cartolas en PDF o fotos se cargan conversando con tu asistente vía MCP (también con vista previa).

## Privacidad

- El archivo se lee en tu navegador; al servidor solo llegan los movimientos que confirmes.
- No subas estos archivos a issues, PRs ni chats públicos.
