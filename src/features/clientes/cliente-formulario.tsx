import { useEffect, useRef, useState, type ComponentProps, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Info } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldShell } from '@/components/shared/field-shell';
import { SubmitBar } from '@/components/shared/submit-bar';
import { useTenantId } from '@/features/member/use-tenant-id';
import { RecordNotFoundError } from '@/lib/data-errors';
import { useSubmitFeedback } from '@/lib/use-submit-feedback';
import { altaCliente, estadoInicialAlta, type AltaClienteEstado } from './cliente-alta';
import {
  emptyClienteValues,
  validateClienteForm,
  valuesFromCliente,
  type ClienteFormErrors,
  type ClienteFormField,
  type ClienteFormValues,
} from './cliente-form';
import { buscarDuplicado, normalizarNombre, type ClienteOpcion } from './cliente-nombre';
import { rutaDelCliente, type DetalleClienteAviso, type ListaClientesAviso } from './cliente-navegacion';
import { ClienteNoEncontrado } from './cliente-no-encontrado';
import type { ClienteDetalle } from './clientes-api';
import { GUARDAR_CLIENTE_CONTEXT } from './constants';
import { EliminarCliente } from './eliminar-cliente';
import { useActualizarCliente, useEliminarCliente } from './use-cliente-mutations';
import { useCrearCliente } from './use-crear-cliente';

/** ids de los campos en el DOM: a dónde va el foco cuando falla la validación. */
const FIELD_DOM_IDS: Record<ClienteFormField, string> = {
  nombre: 'cliente-nombre',
  telefono: 'cliente-telefono',
  email: 'cliente-email',
  direccion: 'cliente-direccion',
};

type ResultadoGuardado = { tipo: 'listo'; id: string } | { tipo: 'duplicado'; existente: ClienteOpcion } | { tipo: 'no-encontrado' };

interface ClienteFormularioProps {
  /** Si viene, se EDITA ese cliente; si no, se crea uno nuevo. */
  cliente?: ClienteDetalle;
  /** Los clientes cargados: contra ellos se busca el duplicado del nombre. */
  clientes: readonly ClienteOpcion[];
  /** `search` de la lista de Clientes ('' o '?q=...'), ya saneado. */
  volver: string;
}

/**
 * Formulario de cliente (alta y edición, el mismo componente): nombre (obligatorio), teléfono, email y dirección (opcionales).
 *
 * Resiliencia (patrón de src/lib/use-submit-feedback.ts):
 *  - El estado de los campos vive acá, en memoria, y NO se limpia si el guardado falla.
 *  - "Reintentar" reenvía el formulario con los mismos valores. En el ALTA es idempotente: un `client_ref` generado al abrir
 *    el formulario, igual en cada reintento (ver `crearClienteIdempotente`), así que un reintento tras una respuesta
 *    perdida no duplica el cliente.
 *  - Tras guardar, la pantalla queda bloqueada ("Guardando…") hasta que se navega al detalle del cliente.
 *
 * Aviso de duplicado (solo del front: la base no tiene unique por nombre porque bloquearía homónimos legítimos): si el
 * nombre normalizado ya está en la lista, NO guarda y avisa "Ya tienes un cliente llamado «X»" con "Guardar de todos
 * modos" y un enlace para ver al que ya existe. Al EDITAR, el propio cliente no cuenta, y solo se avisa si el nombre cambió.
 *
 * Edición: UPDATE por id con todos los campos (un campo vaciado se guarda en `null`), nunca el `client_ref`. "Último guardado
 * gana" entre pestañas.
 */
export function ClienteFormulario({ cliente, clientes, volver }: ClienteFormularioProps) {
  const navigate = useNavigate();
  const tenantId = useTenantId();
  const editando = cliente !== undefined;

  const [values, setValues] = useState<ClienteFormValues>(() => (cliente ? valuesFromCliente(cliente) : emptyClienteValues()));
  const [errors, setErrors] = useState<ClienteFormErrors>({});
  const [focusRequest, setFocusRequest] = useState<{ field: ClienteFormField; n: number } | null>(null);
  const [duplicado, setDuplicado] = useState<ClienteOpcion | null>(null);
  const [gone, setGone] = useState(false);

  // Lo que hay que recordar entre intentos del ALTA: la clave de idempotencia (una al abrir el formulario, la misma en cada
  // reintento, nueva tras guardar bien), las huellas de lo mandado y los nombres que ya pasaron el aviso de duplicado.
  const estadoRef = useRef<AltaClienteEstado>(estadoInicialAlta());

  // ¿Sigue montada la pantalla? Si el usuario se va (o se cierra la sesión) mientras la escritura está en vuelo, al llegar
  // la respuesta NO se navega: lo arrastraría al cliente desde donde esté. La invalidación de las queries sí se hace igual
  // (en `onSettled`, con el tenantId capturado al empezar). Se pone en true en el setup del efecto (no solo en el valor
  // inicial) porque StrictMode monta, desmonta y vuelve a montar.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const crear = useCrearCliente();
  const actualizar = useActualizarCliente();
  const eliminar = useEliminarCliente();
  const { run, pending, release, error, retryable, clearError } = useSubmitFeedback({ context: GUARDAR_CLIENTE_CONTEXT });

  // Foco al primer campo con error (o al nombre, si aparece el aviso de duplicado), después de que se pinte. Es un efecto
  // que solo toca el DOM (no hay setState adentro).
  useEffect(() => {
    if (!focusRequest) return;
    const element = document.getElementById(FIELD_DOM_IDS[focusRequest.field]);
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'center' }); // centrado: no queda bajo el header fijo
  }, [focusRequest]);

  function pedirFoco(field: ClienteFormField) {
    setFocusRequest((previous) => ({ field, n: (previous?.n ?? 0) + 1 }));
  }

  /** Tocar un campo descarta su error. Tocar el nombre descarta además el aviso de duplicado (era de OTRO nombre). */
  function setField(field: ClienteFormField, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => (previous[field] === undefined ? previous : { ...previous, [field]: undefined }));
    if (field === 'nombre') {
      setDuplicado(null);
      clearError();
    }
  }

  async function intentar(forzar: boolean) {
    const validation = validateClienteForm(values);
    if (!validation.ok) {
      setErrors(validation.errors);
      pedirFoco(validation.firstField);
      return;
    }
    setErrors({});
    setDuplicado(null);
    const { columns } = validation;

    // EDICIÓN: el aviso de duplicado solo si el nombre cambió (normalizado) y otro cliente (no este) ya se llama así.
    if (cliente && !forzar && normalizarNombre(columns.nombre) !== normalizarNombre(cliente.nombre)) {
      const existente = buscarDuplicado(columns.nombre, clientes, new Set([cliente.id]));
      if (existente) {
        setDuplicado(existente);
        pedirFoco('nombre');
        return;
      }
    }

    const result = await run<ResultadoGuardado>(async () => {
      if (cliente) {
        try {
          await actualizar.mutateAsync({ tenantId, id: cliente.id, columns });
        } catch (failure) {
          // 0 filas: el cliente ya no existe. No es un error que se arregle reintentando.
          if (failure instanceof RecordNotFoundError) return { tipo: 'no-encontrado' };
          throw failure;
        }
        return { tipo: 'listo', id: cliente.id };
      }
      // ALTA: aviso de duplicado + guardado idempotente (`altaCliente`). Un 23505 del client_ref es "ya estaba guardado".
      const alta = await altaCliente({
        datos: columns,
        forzar,
        clientes,
        estado: estadoRef.current,
        io: { crear: async (args) => (await crear.mutateAsync({ tenantId, ...args })).cliente },
      });
      return alta.tipo === 'duplicado' ? alta : { tipo: 'listo', id: alta.cliente.id };
    });

    if (!result.ok) return; // el error ya se muestra en la SubmitBar, sin tocar los campos
    if (result.data.tipo === 'duplicado') {
      // No se guardó nada: el formulario sigue abierto (se libera el bloqueo del guardado) y se avisa.
      release();
      setDuplicado(result.data.existente);
      pedirFoco('nombre');
      return;
    }
    if (!mountedRef.current) return; // se fue de la pantalla mientras guardaba: no arrastrarlo al cliente
    if (result.data.tipo === 'no-encontrado') {
      setGone(true);
      return;
    }

    // Guardado: la próxima alta (si la hubiera) usa otra clave. Al detalle del cliente (el id lo devolvió la base o es el de
    // la edición): la ruta se arma en el código.
    if (!editando) estadoRef.current = estadoInicialAlta();
    navigate(rutaDelCliente(result.data.id), {
      replace: true,
      state: { aviso: 'cliente-guardado' satisfies DetalleClienteAviso, volver },
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void intentar(false);
  }

  if (gone) return <ClienteNoEncontrado volver={volver} />;

  return (
    <div className="space-y-8">
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <div className="space-y-3">
          <CampoCliente
            id={FIELD_DOM_IDS.nombre}
            label="Nombre"
            value={values.nombre}
            onChange={(value) => setField('nombre', value)}
            error={errors.nombre}
            autoComplete="off"
          />

          {duplicado ? (
            <Alert>
              <Info aria-hidden="true" />
              <div className="space-y-3">
                <AlertDescription className="font-medium">
                  {editando ? 'Ya tienes otro cliente llamado' : 'Ya tienes un cliente llamado'} «{duplicado.nombre}».
                </AlertDescription>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button type="button" variant="outline" disabled={pending} onClick={() => void intentar(true)}>
                    Guardar de todos modos
                  </Button>
                  <Button asChild variant="outline">
                    <Link to={rutaDelCliente(duplicado.id)} state={{ volver }}>
                      Ver ese cliente
                    </Link>
                  </Button>
                </div>
              </div>
            </Alert>
          ) : null}
        </div>

        {/* Teléfono, email y dirección son datos de OTRA persona (el cliente), no del chofer: autoComplete="off" en los tres.
            Con "tel", "email" o "street-address" el navegador puede sugerir los datos del propio chofer dentro de la ficha de
            un cliente y ofrecer guardar el contacto del cliente como perfil de autocompletado (que se sincroniza con su cuenta). */}
        <CampoCliente
          id={FIELD_DOM_IDS.telefono}
          label="Teléfono"
          optional
          type="tel"
          inputMode="tel"
          autoComplete="off"
          hint="Si escribes solo el número, se puede tocar para llamar."
          value={values.telefono}
          onChange={(value) => setField('telefono', value)}
          error={errors.telefono}
        />

        <CampoCliente
          id={FIELD_DOM_IDS.email}
          label="Email"
          optional
          type="email"
          inputMode="email"
          autoComplete="off"
          value={values.email}
          onChange={(value) => setField('email', value)}
          error={errors.email}
        />

        <CampoCliente
          id={FIELD_DOM_IDS.direccion}
          label="Dirección"
          optional
          autoComplete="off"
          value={values.direccion}
          onChange={(value) => setField('direccion', value)}
          error={errors.direccion}
        />

        <SubmitBar pending={pending} error={error} retryable={retryable} label="Guardar cliente" />
      </form>

      {cliente ? (
        <div className="border-t border-border pt-6">
          <EliminarCliente
            clienteId={cliente.id}
            onConfirm={async () => {
              // 0 filas borradas = ya no estaba: para un borrado es lo mismo que éxito.
              await eliminar.mutateAsync({ tenantId, id: cliente.id });
              if (!mountedRef.current) return; // se fue de la pantalla mientras borraba
              navigate(`/clientes${volver}`, { replace: true, state: { aviso: 'cliente-eliminado' satisfies ListaClientesAviso } });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

interface CampoClienteProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  optional?: boolean;
  hint?: string;
  type?: 'text' | 'tel' | 'email';
  inputMode?: ComponentProps<'input'>['inputMode'];
  autoComplete: string;
}

/**
 * Texto de una línea. Sin `maxLength`: cortar en silencio lo que se pega es peor que avisar (el límite se valida al
 * guardar, con mensaje). En el email y el teléfono no hay mayúscula automática ni corrector.
 */
function CampoCliente({ id, label, value, onChange, error, optional = false, hint, type = 'text', inputMode, autoComplete }: CampoClienteProps) {
  const sinCorrector = type !== 'text';
  return (
    <FieldShell id={id} label={label} optional={optional} hint={hint} error={error}>
      {(control) => (
        <Input
          {...control}
          type={type}
          inputMode={inputMode}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          autoCapitalize={sinCorrector ? 'none' : undefined}
          autoCorrect={sinCorrector ? 'off' : undefined}
          spellCheck={sinCorrector ? false : undefined}
          enterKeyHint="next"
        />
      )}
    </FieldShell>
  );
}
