import { COMBUSTIBLE_CATEGORIA_ID, GASTOS_VARIOS_CATEGORIA_ID } from './constants';

/** Lo que la pantalla necesita de una categoría (`categorias_gasto`). */
export interface Categoria {
  id: string;
  nombre: string;
  activa: boolean;
  /** NULL = categoría global (la ven todos los transportistas). */
  transportista_id: string | null;
}

/**
 * ¿Es la categoría global "Combustible"? Se identifica por su id Y por ser
 * global (`transportista_id` NULL). Un transportista puede crear una categoría
 * propia que se llame "Combustible": tiene otro id y `transportista_id` no
 * nulo, y NO debe activar el modo combustible (litros, km, tanque lleno).
 * `undefined` cuenta como "no es global": si el dato no vino, no se activa.
 */
export function isCombustible(categoria: Pick<Categoria, 'id' | 'transportista_id'> | null | undefined): boolean {
  return categoria != null && categoria.id === COMBUSTIBLE_CATEGORIA_ID && categoria.transportista_id === null;
}

/**
 * ¿Es la categoría global "Gastos varios"? Mismo criterio que `isCombustible`: por su id Y por ser global
 * (`transportista_id` NULL). Una categoría propia con ese nombre tiene otro id y `transportista_id` no
 * nulo, y NO exige la descripción. `undefined` cuenta como "no es global".
 */
export function isGastosVarios(categoria: Pick<Categoria, 'id' | 'transportista_id'> | null | undefined): boolean {
  return categoria != null && categoria.id === GASTOS_VARIOS_CATEGORIA_ID && categoria.transportista_id === null;
}

/** Combustible primero (es lo que más se carga) y el resto por nombre, en español. */
export function sortCategorias<T extends Categoria>(categorias: readonly T[]): T[] {
  return [...categorias].sort((a, b) => {
    const aFuel = isCombustible(a);
    const bFuel = isCombustible(b);
    if (aFuel !== bFuel) return aFuel ? -1 : 1;
    return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
  });
}

/**
 * Categorías para elegir: SOLO las activas, más la que ya está elegida aunque
 * esté inactiva (`keepId`): al editar un gasto cuya categoría se desactivó
 * después, tiene que seguir viéndose en el selector (si no, el formulario
 * quedaría sin categoría y obligaría a cambiarla sin querer).
 */
export function categoriasParaElegir<T extends Categoria>(categorias: readonly T[], keepId?: string | null): T[] {
  return sortCategorias(categorias.filter((c) => c.activa || c.id === keepId));
}

/** Nombre para mostrar: marca las inactivas, así no se confunden con las vigentes. */
export function nombreParaMostrar(categoria: Pick<Categoria, 'nombre' | 'activa'>): string {
  return categoria.activa ? categoria.nombre : `${categoria.nombre} (inactiva)`;
}
