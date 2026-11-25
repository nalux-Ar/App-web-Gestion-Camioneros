import { Package, Truck } from 'lucide-react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { AYUDA_INICIO } from '@/features/ayuda/ayuda-pantallas';
import { BotonAyuda } from '@/features/ayuda/boton-ayuda';
import { CamionActivoCard } from '@/features/camiones/camion-activo-card';
import { CargarCamionCard } from '@/features/camiones/cargar-camion-card';
import { useMember } from '@/features/member/use-member';
import { ACCESO_RESUMEN, ACCESO_VER_VIAJES, ACCION_ANOTAR_GASTO, ACCION_ANOTAR_VIAJE } from './inicio-textos';

/**
 * Inicio: arriba el saludo y el camión; abajo, lo que se hace todos los días.
 *  - Dos botones GRANDES (56 px, texto de 18 px, a todo el ancho): «Anotar un gasto» y «Anotar un viaje». Anotar un gasto
 *    es lo más frecuente y antes costaba dos toques (Gastos, después «Nuevo gasto»): ahora es uno.
 *  - Debajo, dos accesos de contorno en una fila (48 px como mínimo, texto de 16 px): «Ver mis viajes» y «Resumen». Pueden
 *    partirse en dos líneas en una pantalla angosta (320 px) en vez de salirse del botón.
 * «Clientes» ya no está acá: sigue en las dos barras de navegación. Todos son ENLACES (`Button asChild` + `Link`), no botones
 * que naveguen por código: se abren en otra pestaña, se copian y los anuncia el lector de pantalla como enlaces. En escritorio
 * la columna se limita (`max-w-xl`) para que los botones no queden desmesurados.
 */
export function InicioPage() {
  const { member } = useMember();

  return (
    <div className="space-y-6">
      <div>
        {/* El botón «Ayuda» de Inicio es el último paso del recorrido (`data-ayuda`); ahí también se repite el recorrido. */}
        <div className="flex items-center gap-3">
          <h1 className="min-w-0 break-words text-2xl font-semibold">
            Hola{member?.transportistaNombre ? `, ${member.transportistaNombre}` : ''}
          </h1>
          <BotonAyuda ayuda={AYUDA_INICIO} dataAyuda="ayuda-inicio" conRecorrido />
        </div>
        <p className="text-muted-foreground">¿Qué quieres hacer hoy?</p>
      </div>
      {/* Solo mientras la cuenta no tiene ningún camión (y solo para el administrador). */}
      <CargarCamionCard />
      {/* El camión con el que trabaja (con 1 camión activo, solo se muestra; con 2 o más, se elige acá). Excluyente con la
          de arriba: esta no muestra nada sin camiones activos. */}
      <CamionActivoCard />
      <div className="max-w-xl space-y-3">
        <Button asChild size="lg" className="w-full [&_svg]:size-6">
          <Link to="/gastos/nuevo">
            <Package aria-hidden="true" />
            {ACCION_ANOTAR_GASTO}
          </Link>
        </Button>
        <Button asChild size="lg" className="w-full [&_svg]:size-6">
          <Link to="/viajes/nuevo">
            <Truck aria-hidden="true" />
            {ACCION_ANOTAR_VIAJE}
          </Link>
        </Button>
        <div className="grid grid-cols-2 gap-3 pt-1">
          <Button asChild variant="outline" className="h-auto min-h-12 whitespace-normal px-3 py-2 text-center leading-tight">
            <Link to="/viajes">{ACCESO_VER_VIAJES}</Link>
          </Button>
          <Button asChild variant="outline" className="h-auto min-h-12 whitespace-normal px-3 py-2 text-center leading-tight">
            <Link to="/resumen">{ACCESO_RESUMEN}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
