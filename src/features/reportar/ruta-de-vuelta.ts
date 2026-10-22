import { isUuid } from '@/lib/uuid';
import { sanearPantalla } from './ultima-pantalla';

/**
 * "Volver" después de enviar un reporte: lista blanca de rutas de la app. Módulo aparte de `ultima-pantalla.ts` a propósito:
 * el registro de la pantalla va en el chunk principal (lo usan el `AppShell` y el `AuthProvider`); esto solo lo usa la
 * pantalla de reportar, que se carga diferida.
 */

const UUID = ':uuid';

/** Las rutas de la app logueada a las que se puede volver (`:uuid` = un uuid válido). Ni `/reportar` ni `/reportes`. */
const RUTAS_DE_VUELTA: readonly string[] = [
  '/',
  '/viajes',
  '/viajes/nuevo',
  `/viajes/${UUID}`,
  `/viajes/${UUID}/editar`,
  `/viajes/${UUID}/devoluciones/nueva`,
  `/viajes/${UUID}/devoluciones/${UUID}/editar`,
  '/gastos',
  '/gastos/nuevo',
  `/gastos/${UUID}/editar`,
  '/clientes',
  '/clientes/nuevo',
  `/clientes/${UUID}`,
  `/clientes/${UUID}/editar`,
  '/camiones',
  '/camiones/nuevo',
  `/camiones/${UUID}/editar`,
  '/resumen',
  '/configuracion',
];

/** La búsqueda solo con caracteres de parámetros simples (la valida después cada pantalla). */
const BUSQUEDA_SIMPLE = /^\?[A-Za-z0-9=&_.%-]{1,200}$/;

function coincide(pathname: string, ruta: string): boolean {
  const partes = pathname.split('/');
  const esperadas = ruta.split('/');
  if (partes.length !== esperadas.length) return false;
  return esperadas.every((esperada, i) => (esperada === UUID ? isUuid(partes[i]) : esperada === partes[i]));
}

/**
 * A dónde lleva "Volver": la pantalla anotada si está saneada y su ruta está en la lista blanca de la app (con la
 * búsqueda solo si es simple); si no, Inicio.
 */
export function rutaDeVuelta(pantalla: string | null): string {
  const saneada = sanearPantalla(pantalla);
  if (saneada === null) return '/';
  const corte = saneada.indexOf('?');
  const pathname = corte === -1 ? saneada : saneada.slice(0, corte);
  const search = corte === -1 ? '' : saneada.slice(corte);
  if (!RUTAS_DE_VUELTA.some((ruta) => coincide(pathname, ruta))) return '/';
  return BUSQUEDA_SIMPLE.test(search) ? `${pathname}${search}` : pathname;
}
