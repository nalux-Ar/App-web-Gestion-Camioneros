import { Info } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { textoPrimerCamion } from './camion-navegacion';
import { useConteoSinCamion } from './use-camiones';

/**
 * Aviso ANTES de cargar el PRIMER camión del tenant: `crear_camion` le asigna todos los viajes sin camión y los gastos con
 * litros sin camión (automático, sin opción de excluir). Los dos números se piden frescos al mostrarse (`useConteoSinCamion`)
 * y, como la consulta queda "lista" recién cuando terminó (`fetchStatus` 'idle'), nunca se muestra un número viejo. Si no
 * se pudo contar, el texto lo dice igual sin números. Región `aria-live`: el texto cambia al llegar el conteo.
 */
export function PrimerCamionAviso({ activo }: { activo: boolean }) {
  const conteo = useConteoSinCamion(activo);
  if (!activo) return null;

  const terminado = conteo.fetchStatus === 'idle';
  const texto = textoPrimerCamion(
    terminado && conteo.data !== undefined && !conteo.isError
      ? { tipo: 'listo', viajes: conteo.data.viajes, gastos: conteo.data.gastos }
      : terminado && conteo.isError
        ? { tipo: 'error' }
        : { tipo: 'cargando' },
  );

  return (
    <Alert role="status" aria-live="polite">
      <Info aria-hidden="true" />
      <AlertDescription>{texto}</AlertDescription>
    </Alert>
  );
}
