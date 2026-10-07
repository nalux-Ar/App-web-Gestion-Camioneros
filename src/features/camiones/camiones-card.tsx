import { Link } from 'react-router';
import { Truck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RUTA_CAMIONES } from './camion-navegacion';
import { useCamiones } from './use-camiones';

function textoCantidad(activos: number): string {
  if (activos === 0) return 'Todavía no tienes camiones activos.';
  return activos === 1 ? '1 camión activo.' : `${activos} camiones activos.`;
}

/**
 * Tarjeta "Camiones" de Configuración: es el acceso a la pantalla de camiones (no hay ítem en la barra de abajo). Dice
 * cuántos camiones activos hay; si la lista no cargó, no dice un número (el enlace sigue).
 */
export function CamionesCard() {
  const camiones = useCamiones();
  const activos = camiones.data?.items.filter((camion) => camion.activa).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Camiones</CardTitle>
        <CardDescription>Los camiones de la cuenta: cada viaje y cada carga de combustible queda asociada a uno.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {activos !== undefined ? <p className="text-base">{textoCantidad(activos)}</p> : null}
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link to={RUTA_CAMIONES}>
            <Truck aria-hidden="true" /> Ver camiones
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
