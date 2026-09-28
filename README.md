# Elan

App web para camioneros y transportistas de carga: registro de viajes, gastos, clientes, entregas y devoluciones. Multi-tenant, pensada para usarse desde el celular.

**Código propietario:** este repositorio es público solo para despliegue. Todos los derechos reservados; ver [LICENSE](LICENSE).

## Stack
React 19 + Vite + TypeScript + Tailwind CSS + shadcn/ui, con Supabase (Postgres + Auth, aislamiento por RLS). Deploy en Vercel.

## Desarrollo
```bash
npm install
cp .env.example .env.local   # completar VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev                  # http://localhost:3000
```

`npm run lint` y `npm run build` tienen que pasar antes de cada commit. La documentación del proyecto está en `CONTEXT.md` y `PLAN.md`.
