import { BarChart3, Home, Package, Settings, Truck, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** Las 5 secciones de uso diario: van en la barra inferior en mobile y
 *  arriba en la barra lateral de escritorio. */
export const PRIMARY_NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Inicio', icon: Home },
  { to: '/viajes', label: 'Viajes', icon: Truck },
  { to: '/gastos', label: 'Gastos', icon: Package },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/reportes', label: 'Reportes', icon: BarChart3 },
];

/**
 * Configuración no entra en la barra inferior de mobile: "Configuración"
 * (13 caracteres) no entra legible junto a otros 5 ítems en 360px de
 * ancho sin truncarse o partirse en dos líneas, y es una acción mucho
 * menos frecuente que las 5 de arriba (un camionero carga viajes/gastos
 * todos los días; entra a Configuración de vez en cuando). Se resuelve
 * con un botón en el header en mobile, y como sexto ítem en la barra
 * lateral de escritorio (ahí sí hay lugar de sobra). Ver Header/SidebarNav.
 */
export const CONFIGURACION_ITEM: NavItem = { to: '/configuracion', label: 'Configuración', icon: Settings };

export const ALL_NAV_ITEMS: readonly NavItem[] = [...PRIMARY_NAV_ITEMS, CONFIGURACION_ITEM];
