import { Link } from 'react-router';
import { SearchX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import { RUTA_CAMIONES } from './camion-navegacion';

/** Estado de "ese camión no existe": id inválido en la URL, o de otro transportista (la base no distingue, el mensaje tampoco). */
export function CamionNoEncontrado() {
  return (
    <EmptyState
      icon={SearchX}
      title="Camión no encontrado"
      description="Puede que el enlace no sea correcto."
      action={
        <Button asChild size="lg">
          <Link to={RUTA_CAMIONES}>Volver a Camiones</Link>
        </Button>
      }
    />
  );
}
