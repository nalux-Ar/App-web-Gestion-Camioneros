import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SubmitBar } from '@/components/shared/submit-bar';
import { TextareaField } from '@/components/shared/textarea-field';
import { generateClientRef } from '@/features/gastos/client-ref';
import { useScrollToTopOnMount } from '@/lib/use-scroll-to-top';
import { useSubmitFeedback } from '@/lib/use-submit-feedback';
import { cn } from '@/lib/utils';
import { armarContexto } from './contexto';
import { ENVIAR_REPORTE_CONTEXT } from './reportar-api';
import { caracteresDelMensaje, validarMensaje } from './reportar-form';
import {
  AYUDA_MENSAJE,
  BOTON_ENVIAR,
  BOTON_VOLVER,
  ENVIANDO,
  ETIQUETA_MENSAJE,
  GRACIAS_TEXTO,
  GRACIAS_TITULO,
  INTRO_REPORTAR,
  MAX_MENSAJE,
  QUE_SE_ENVIA,
  textoContador,
  TITULO_REPORTAR,
} from './reportar-textos';
import { rutaDeVuelta } from './ruta-de-vuelta';
import { leerUltimaPantalla, pantallaParaElReporte } from './ultima-pantalla';
import { useEnviarReporte } from './use-enviar-reporte';

const CAMPO_ID = 'reporte-mensaje';
const GRACIAS_ID = 'reporte-gracias';

/**
 * "Reportar un problema" (`/reportar`): un mensaje (obligatorio, hasta 2000 caracteres) que se manda a la base junto con la
 * última pantalla de trabajo y un contexto técnico sin datos personales (`contexto.ts`). No hay lista de reportes: la tabla
 * es solo-INSERT.
 *
 * Resiliencia (el patrón de `useSubmitFeedback`): mientras envía, botón deshabilitado; si falla, el error con "Reintentar"
 * y lo escrito queda INTACTO; sin red, el aviso (`OfflineBanner`, dentro de la `SubmitBar`) y el envío falla en el momento
 * (sin reintentos solos ni pausa). "Reintentar" manda el MISMO `client_ref` (si el intento anterior llegó, la base lo
 * reconoce y es éxito); si se cambió el texto, va con uno nuevo (es otro reporte).
 *
 * Al salir bien: "Gracias, lo recibimos" (con el foco) y "Volver" a la pantalla de origen, solo si pasa la lista blanca de
 * rutas de la app (`rutaDeVuelta`), o a Inicio.
 */
export function ReportarPage() {
  useScrollToTopOnMount();
  const [texto, setTexto] = useState('');
  const [errorCampo, setErrorCampo] = useState<string | null>(null);
  const [focoAlCampo, setFocoAlCampo] = useState(0);
  const [destino, setDestino] = useState<string | null>(null);

  // La clave de idempotencia: una al abrir la pantalla, la misma en cada reintento del MISMO texto.
  const intentoRef = useRef<{ clientRef: string; mensaje: string | null }>({ clientRef: generateClientRef(), mensaje: null });

  // ¿Sigue montada? Si la persona se va mientras se envía, al llegar la respuesta no se pinta nada.
  const montadaRef = useRef(false);
  useEffect(() => {
    montadaRef.current = true;
    return () => {
      montadaRef.current = false;
    };
  }, []);

  // Foco al campo con error, después de que se pinte (solo toca el DOM).
  useEffect(() => {
    if (focoAlCampo === 0) return;
    const campo = document.getElementById(CAMPO_ID);
    if (!campo) return;
    campo.focus({ preventScroll: true });
    campo.scrollIntoView({ block: 'center' });
  }, [focoAlCampo]);

  const enviar = useEnviarReporte();
  const { run, pending, error, retryable } = useSubmitFeedback({ context: ENVIAR_REPORTE_CONTEXT });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validacion = validarMensaje(texto);
    if (!validacion.ok) {
      setErrorCampo(validacion.error);
      setFocoAlCampo((n) => n + 1);
      return;
    }
    setErrorCampo(null);

    // Otro texto que el del intento anterior = otro reporte: otra clave. El mismo texto (un "Reintentar") = la misma.
    const intento = intentoRef.current;
    if (intento.mensaje !== null && intento.mensaje !== validacion.mensaje) intento.clientRef = generateClientRef();
    intento.mensaje = validacion.mensaje;

    // Al servidor va SOLO el nombre de la pantalla (sin búsqueda ni ids); la ruta completa queda acá, para el "Volver".
    const pantalla = leerUltimaPantalla();
    const resultado = await run(() =>
      enviar.mutateAsync({
        mensaje: validacion.mensaje,
        pantalla: pantallaParaElReporte(pantalla),
        contexto: armarContexto(),
        clientRef: intento.clientRef,
      }),
    );
    if (!resultado.ok || !montadaRef.current) return; // el error ya se ve en la SubmitBar, con lo escrito intacto
    setDestino(rutaDeVuelta(pantalla));
  }

  const caracteres = caracteresDelMensaje(texto);

  return (
    <div className="max-w-xl space-y-5">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{TITULO_REPORTAR}</h1>
        <p className="text-muted-foreground">{INTRO_REPORTAR}</p>
      </div>

      {destino !== null ? (
        <Gracias destino={destino} />
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-5">
          <TextareaField
            id={CAMPO_ID}
            label={ETIQUETA_MENSAJE}
            rows={6}
            value={texto}
            onChange={(valor) => {
              setTexto(valor);
              setErrorCampo(null);
            }}
            error={errorCampo}
            hint={
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span>{AYUDA_MENSAJE}</span>
                <span data-contador="" className={cn('tabular-nums', caracteres > MAX_MENSAJE && 'font-medium text-destructive-text')}>
                  {textoContador(caracteres)}
                </span>
              </span>
            }
          />

          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {QUE_SE_ENVIA}
          </p>

          <SubmitBar pending={pending} error={error} retryable={retryable} label={BOTON_ENVIAR} pendingLabel={ENVIANDO} />
        </form>
      )}
    </div>
  );
}

/** El éxito: el título recibe el foco (los lectores de pantalla lo anuncian) y "Volver" lleva a la pantalla de origen. */
function Gracias({ destino }: { destino: string }) {
  const tituloRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    tituloRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby={GRACIAS_ID} className="space-y-4 rounded-lg border border-border bg-card p-6 text-center">
      <CheckCircle2 className="mx-auto size-10 text-primary" aria-hidden="true" />
      <div className="space-y-1">
        <h2 id={GRACIAS_ID} ref={tituloRef} tabIndex={-1} className="text-lg font-semibold focus-visible:outline-none">
          {GRACIAS_TITULO}
        </h2>
        <p className="text-muted-foreground">{GRACIAS_TEXTO}</p>
      </div>
      <Button asChild size="lg" className="w-full sm:w-auto">
        <Link to={destino} replace>
          {BOTON_VOLVER}
        </Link>
      </Button>
    </section>
  );
}
