import { useId, useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChoiceGroup } from '@/components/shared/choice-group';
import { InlineError } from '@/components/shared/inline-error';
import { SelectField } from '@/components/shared/select-field';
import { useAuth } from '@/features/auth/use-auth';
import { useMember } from '@/features/member/use-member';
import { useTenantId } from '@/features/member/use-tenant-id';
import { useSubmitFeedback } from '@/lib/use-submit-feedback';
import { cn } from '@/lib/utils';
import { buscarCamion, descripcionCamion, etiquetaCamion, ordenarCamiones, type CamionDeLista } from './camion';
import { resolverCamionActivo } from './camion-activo';
import { CAMBIAR_CAMION_ACTIVO_CONTEXT, MAX_BOTONES_CAMION } from './constants';
import { formatearPatente } from './patente';
import { useCamiones } from './use-camiones';
import { useCambiarCamionActivo } from './use-cambiar-camion-activo';

/** Texto de la opción que se está guardando (guardado pesimista: todavía no es la marcada). */
const GUARDANDO = 'Guardando…';

/**
 * Tarjeta del camión activo en Inicio (Etapa 5c): AHÍ se elige el camión con el que trabaja la persona, el que precompleta
 * los viajes y las cargas de combustible NUEVOS (ver `decidirCamion`). Convive con "Carga tu camión" (`CargarCamionCard`),
 * que sale solo con 0 camiones: son excluyentes.
 *
 *  - Lista de camiones cargando o con error: no se muestra nada (no se adivina).
 *  - 0 camiones activos: nada.
 *  - 1 camión activo: "Tu camión", de solo lectura (se usa ese siempre; el diseño no cambia al cargar el segundo).
 *  - 2 o más: "Camión activo", con un control para elegir entre los ACTIVOS (botones hasta `MAX_BOTONES_CAMION`, lista
 *    desplegable desde ahí, como el selector de los formularios) y el activo válido marcado. Si no hay uno válido (ninguno
 *    guardado, o el guardado está archivado o ya no existe: `resolverCamionActivo`), la tarjeta se destaca y lo pide.
 *
 * Guardado PESIMISTA (`useCambiarCamionActivo`): la opción marcada es siempre la que la base ya confirmó. Mientras guarda,
 * los controles se deshabilitan y la opción elegida dice "Guardando…"; al confirmar se marca y se anuncia (región
 * `role="status"`). Si falla, queda la de antes y el error se muestra con `InlineError` ("Reintentar" solo si sirve).
 */
export function CamionActivoCard() {
  const { user } = useAuth();
  const { member } = useMember();
  const tenantId = useTenantId();
  const camionesQuery = useCamiones();
  const cambiar = useCambiarCamionActivo();
  const { run, pending, error, retryable } = useSubmitFeedback({ context: CAMBIAR_CAMION_ACTIVO_CONTEXT });
  // El camión que se está guardando (para "Guardando…") y el último pedido (para "Reintentar").
  const [guardando, setGuardando] = useState<string | null>(null);
  const [ultimoPedido, setUltimoPedido] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState('');
  const tituloId = useId();

  const camiones = camionesQuery.data?.items;
  if (camiones === undefined) return null;
  const activos = ordenarCamiones(camiones.filter((camion) => camion.activa));
  if (activos.length === 0) return null;
  if (activos.length === 1) return <TuCamion camion={activos[0]!} tituloId={tituloId} />;

  const { camion: activo } = resolverCamionActivo({ camiones, camionActivoId: member?.camionActivoId ?? null });
  const sinActivo = activo === null;

  async function elegir(camionId: string) {
    if (!user || pending || camionId === '' || camionId === activo?.id) return;
    setGuardando(camionId);
    setUltimoPedido(camionId);
    setAnuncio('');
    const result = await run(() => cambiar.mutateAsync({ tenantId, userId: user.id, camionId }), { keepLocked: false });
    setGuardando(null);
    if (result.ok) {
      const guardado = camiones ? buscarCamion(camiones, result.data) : null;
      setAnuncio(guardado ? `Camión activo: ${formatearPatente(guardado.patente)}.` : '');
    }
  }

  const control = activos.length <= MAX_BOTONES_CAMION ? 'botones' : 'lista';
  const opciones = activos.map((camion) => {
    const etiqueta = etiquetaCamion(camion, { conDescripcion: control === 'lista' });
    return { value: camion.id, label: guardando === camion.id ? `${etiqueta} · ${GUARDANDO}` : etiqueta };
  });

  return (
    <Card role="region" aria-labelledby={tituloId} className={cn(sinActivo && 'border-primary/50')}>
      <CardHeader>
        <CardTitle id={tituloId}>Camión activo</CardTitle>
        <CardDescription>Se usa en tus viajes y cargas de combustible nuevos. En cada registro puedes elegir otro.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sinActivo ? <p className="text-base font-medium">Elige el camión con el que vas a trabajar.</p> : null}
        {control === 'botones' ? (
          <ChoiceGroup
            id="camion-activo"
            legend="Elige el camión"
            value={activo?.id ?? ''}
            onChange={(camionId) => void elegir(camionId)}
            options={opciones}
            columns={2}
            disabled={pending}
          />
        ) : (
          <SelectField
            id="camion-activo"
            label="Elige el camión"
            placeholder="Elige el camión"
            value={activo?.id ?? ''}
            onChange={(camionId) => void elegir(camionId)}
            options={opciones}
            disabled={pending}
          />
        )}
        {error ? (
          <InlineError
            message={error}
            onRetry={retryable && ultimoPedido ? () => void elegir(ultimoPedido) : undefined}
            retrying={pending}
          />
        ) : null}
        {/* Siempre presente: anuncia "Guardando…" y, al confirmar, el camión que quedó como activo. */}
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {pending ? GUARDANDO : anuncio}
        </p>
      </CardContent>
    </Card>
  );
}

/** Un solo camión activo: se usa ese siempre, sin nada que elegir (línea de solo lectura). */
function TuCamion({ camion, tituloId }: { camion: CamionDeLista; tituloId: string }) {
  const descripcion = descripcionCamion(camion);
  return (
    <Card role="region" aria-labelledby={tituloId}>
      <CardHeader>
        <CardTitle id={tituloId}>Tu camión</CardTitle>
        <CardDescription>Se usa en tus viajes y cargas de combustible.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-lg font-semibold tabular-nums">{formatearPatente(camion.patente)}</p>
        {descripcion ? <p className="break-words text-sm text-muted-foreground">{descripcion}</p> : null}
      </CardContent>
    </Card>
  );
}
