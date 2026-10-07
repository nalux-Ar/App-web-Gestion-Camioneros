import { Link } from 'react-router';
import { Truck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useMember } from '@/features/member/use-member';
import { RUTA_NUEVO_CAMION } from './camion-navegacion';
import { useCamiones } from './use-camiones';

/**
 * Tarjeta "Carga tu camión" de Inicio: aparece SOLO mientras la cuenta no tiene ningún camión (contando archivados) y solo
 * para el administrador (es el único que puede cargarlo). Así el camión se carga antes de llegar a una carga de
 * combustible con litros, que lo exige. Mientras la lista carga, o si falla, no se muestra nada.
 */
export function CargarCamionCard() {
  const { member } = useMember();
  const esAdmin = member?.rol === 'admin';
  const camiones = useCamiones({ enabled: esAdmin });

  if (!esAdmin || camiones.data === undefined || camiones.data.items.length > 0) return null;

  return (
    <Card className="border-primary/50">
      <CardHeader>
        <CardTitle>Carga tu camión</CardTitle>
        <CardDescription>
          Con tu camión cargado, cada carga de combustible queda asociada a él y se puede calcular el rendimiento.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild size="lg" className="w-full sm:w-auto">
          <Link to={RUTA_NUEVO_CAMION}>
            <Truck aria-hidden="true" /> Cargar camión
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
