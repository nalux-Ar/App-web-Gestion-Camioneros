import { Link } from 'react-router';
import { SearchX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';

/** Estado de "ese viaje no existe": id inválido en la URL, borrado por otro lado, o de otro transportista
 *  (la base no distingue las dos últimas: a propósito, el mensaje tampoco). */
export function ViajeNoEncontrado({ volver = '' }: { volver?: string }) {
  return (
    <EmptyState
      icon={SearchX}
      title="Viaje no encontrado"
      description="Puede que ya lo hayas eliminado, o que el enlace no sea correcto."
      action={
        <Button asChild size="lg">
          <Link to={`/viajes${volver}`}>Volver a Viajes</Link>
        </Button>
      }
    />
  );
}
