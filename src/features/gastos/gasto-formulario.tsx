import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router';

import { ChoiceGroup } from '@/components/shared/choice-group';
import { ConfirmDelete } from '@/components/shared/confirm-delete';
import { DateField } from '@/components/shared/date-field';
import { InlineError } from '@/components/shared/inline-error';
import { MultiChoiceGroup } from '@/components/shared/multi-choice-group';
import { NumberField } from '@/components/shared/number-field';
import { SelectField } from '@/components/shared/select-field';
import { SubmitBar } from '@/components/shared/submit-bar';
import { TextareaField } from '@/components/shared/textarea-field';
import { Button } from '@/components/ui/button';
import type { CamionDeLista } from '@/features/camiones/camion';
import {
  CAMIONES_SIN_CARGAR_MESSAGE,
  combinarCamiones,
  decidirCamion,
  domIdDelCamion,
  resolverCamion,
  type DecisionCamion,
  type ResolucionCamion,
} from '@/features/camiones/camion-seleccion';
import { CamionSelector } from '@/features/camiones/camion-selector';
import { useCamiones } from '@/features/camiones/use-camiones';
import { estadoDesdeCliente } from '@/features/clientes/cliente-navegacion';
import { useMember } from '@/features/member/use-member';
import { useTenantId } from '@/features/member/use-tenant-id';
import { RECIENTES_LIMIT } from '@/features/viajes/constants';
import { useViajesRecientes } from '@/features/viajes/use-viajes';
import { rutaDelViaje, type DesdeViaje, type DetalleAviso } from '@/features/viajes/viaje-navegacion';
import { etiquetaDeViaje, opcionesDeViaje, type ViajeOpcion } from '@/features/viajes/viaje-opciones';
import { mapDataError, RecordNotFoundError } from '@/lib/data-errors';
import { isValidDateString, todayLocal } from '@/lib/dates';
import { formatMoney } from '@/lib/numbers';
import { charLength } from '@/lib/text';
import { useSubmitFeedback } from '@/lib/use-submit-feedback';
import {
  categoriasParaElegir,
  isCombustible,
  isGastosVarios,
  nombreParaMostrar,
  sortCategorias,
  type Categoria,
} from './categorias';
import {
  DESCRIPCION_COUNTER_FROM,
  ELIMINAR_GASTO_CONTEXT,
  GUARDAR_GASTO_CONTEXT,
  MAX_DESCRIPCION,
  MAX_GASTOS_POR_CARGA,
  METODO_PAGO_LABELS,
  MIN_FECHA,
  METODO_PAGO_ORDER,
  type GastoAviso,
} from './constants';
import { EmpezarDeNuevo } from './empezar-de-nuevo';
import { claveDeCategoria, nuevoEnvio, reiniciarEnvio, type EnvioDeLaCarga } from './gasto-envio';
import { BOTON_CAMBIAR_FECHA, NOMBRE_CAMBIAR_FECHA, ROTULO_FECHA, textoDeLaFecha } from './gasto-fecha-textos';
import {
  emptyGastoValues,
  previewPrecioPorLitro,
  validateGastoForm,
  valuesFromGasto,
  type GastoFormValues,
  type TanqueLlenoChoice,
} from './gasto-form';
import { validateLoteDeGastos, type BloqueDeGasto } from './gasto-lote';
import { LoteDeGastosDistintoError } from './gasto-lote-errores';
import type { GastoParaGuardar } from './gasto-lote-save';
import { GUARDAR_LOTE_CONTEXT } from './gasto-lote-textos';
import { GastoNoEncontrado } from './gasto-no-encontrado';
import {
  AYUDA_EN_QUE_GASTASTE,
  ETIQUETA_DESCRIPCION,
  ETIQUETA_EN_QUE_GASTASTE,
  etiquetaDeNota,
  hayDatosEnElPliegue,
  textoDelPliegue,
} from './gasto-pliegue';
import { textoPreguntaEliminar } from './gasto-textos';
import {
  SIN_ERRORES,
  erroresDelLote,
  erroresDeUnGasto,
  primerErrorVisual,
  sinErrorCompartido,
  sinErrorDeCategoria,
  sinErrorDelBloque,
  sinErroresDeBloques,
  type ErroresDeCarga,
  type PuestoDeCampo,
} from './gasto-varios-errores';
import {
  CARGA_VACIA,
  SIN_CATEGORIA,
  alternarCategoria,
  bloqueDe,
  cambiarCampo,
  cargaConUna,
  elegirUnica,
  type CampoDelBloque,
  type CamposDelBloque,
  type CargaDeGastos,
} from './gasto-varios-estado';
import {
  AVISO_CATEGORIA_CAMBIABLE,
  AVISO_CATEGORIAS_FIJAS,
  AVISO_TOPE_DE_CATEGORIAS,
  AYUDA_VARIAS_CATEGORIAS,
  LEYENDA_COMO_PAGASTE,
  TITULO_COMO_PAGASTE,
  TITULO_DATOS_DEL_COMBUSTIBLE,
  anuncioDeGastos,
  botonGuardarGastos,
  etiquetaMetodoDePago,
} from './gasto-varios-textos';
import type { GastoDetalle } from './gastos-api';
import { searchDelMesDeFecha } from './gastos-filters';
import { useActualizarGasto, useCrearGasto, useCrearGastos, useEliminarGasto } from './use-gasto-mutations';

/** Los ids base de los campos en el DOM: a dónde va el foco cuando falla la validación. */
const IDS = {
  categoria: 'gasto-categoria', // el grupo; la primera opción es `gasto-categoria-0`
  descripcion: 'gasto-descripcion',
  monto: 'gasto-monto',
  // Prefijo: el control real depende de la decisión (botones `gasto-camion-0`, lista `gasto-camion` o bloque
  // `gasto-camion-bloque`; la línea "Camión: …" es `gasto-camion-linea` y nunca recibe el foco de un error); ver
  // `domIdDelCamion`.
  camion: 'gasto-camion',
  litros: 'gasto-litros',
  km: 'gasto-km',
  tanque: 'gasto-tanque', // el grupo; la primera opción es `gasto-tanque-0`
  fecha: 'gasto-fecha',
  viaje: 'gasto-viaje',
  pliegue: 'gasto-pliegue', // la región de «Agregar nota o viaje»: SIEMPRE está en la página (oculta mientras está plegada)
  metodo: 'gasto-metodo', // el grupo de 4 botones; la primera opción es `gasto-metodo-0`
} as const;

/**
 * Los ids de los campos de UN bloque. Con una sola categoría (o ninguna, o editando) son los de siempre; con varias llevan al final el
 * id de su categoría, para que no se repitan entre bloques. La fecha y el viaje no son de ningún bloque: nunca llevan sufijo.
 */
function idsDelBloque(categoriaId: string | null) {
  const sufijo = categoriaId === null ? '' : `-${categoriaId}`;
  return {
    descripcion: `${IDS.descripcion}${sufijo}`,
    monto: `${IDS.monto}${sufijo}`,
    camion: `${IDS.camion}${sufijo}`,
    litros: `${IDS.litros}${sufijo}`,
    km: `${IDS.km}${sufijo}`,
    tanque: `${IDS.tanque}${sufijo}`,
    metodo: `${IDS.metodo}${sufijo}`,
    titulo: `gasto-bloque${sufijo}`,
  };
}

/** El id del DOM del control al que va el foco de un error. Con varios bloques cada campo lleva el sufijo de su bloque. */
function idDelPuesto(puesto: PuestoDeCampo, conSufijo: boolean, decision: DecisionCamion | null): string {
  if (puesto.clave === null) {
    if (puesto.campo === 'fecha') return IDS.fecha;
    if (puesto.campo === 'viajeId') return IDS.viaje;
    return `${IDS.categoria}-0`;
  }
  const ids = idsDelBloque(conSufijo ? puesto.clave : null);
  switch (puesto.campo) {
    case 'descripcion':
      return ids.descripcion;
    case 'monto':
      return ids.monto;
    case 'camionId':
      // El camión no tiene un único control: el foco va al que se está mostrando (botón, lista o bloque).
      return domIdDelCamion(ids.camion, decision);
    case 'litros':
      return ids.litros;
    case 'kmOdometro':
      return ids.km;
    case 'tanqueLleno':
      return `${ids.tanque}-0`; // la primera opción del grupo
    case 'metodoPago':
      return `${ids.metodo}-0`; // el primer botón del grupo
    default:
      return `${IDS.categoria}-0`;
  }
}

const METODO_PAGO_OPTIONS = METODO_PAGO_ORDER.map((value) => ({ value, label: METODO_PAGO_LABELS[value] }));

const TANQUE_OPTIONS: ReadonlyArray<{ value: TanqueLlenoChoice; label: string }> = [
  { value: 'si', label: 'Sí' },
  { value: 'no', label: 'No' },
  { value: '', label: 'No sé' },
];

type ResultadoGuardado = 'listo' | 'no-encontrado';

/** Lo del combustible: solo existe un bloque de Combustible, así que esto es de TODA la carga y se conserva si se cambia de categoría y se vuelve. */
interface DatosDeCombustible {
  /** El camión elegido EN PANTALLA ('' = no se tocó: vale el precompletado de la decisión, si lo hay). */
  camionId: string;
  litros: string;
  kmOdometro: string;
  tanqueLleno: TanqueLlenoChoice;
}

interface GastoFormularioProps {
  /** Todas las categorías (activas e inactivas). */
  categorias: readonly Categoria[];
  /** Si viene, se EDITA ese gasto; si no, se crea uno nuevo. */
  gasto?: GastoDetalle;
  /** `search` de la lista a la que volver ('' o '?mes=...&categoria=...'), ya validado. */
  volver: string;
  /**
   * Solo si el gasto se abrió desde el detalle de un viaje (ya validado, ver `leerDesdeViaje`): al guardar y al
   * borrar se vuelve a ESE viaje en vez de a la lista de gastos.
   */
  desdeViaje?: DesdeViaje | null;
  /** El viaje que llegó preseleccionado por `?viaje=` (ya consultado y existente). Solo en el alta. */
  viajePreseleccionado?: ViajeOpcion | null;
}

/**
 * Formulario de gasto (alta y edición, el mismo componente).
 *
 * Alta con VARIAS categorías (cargar varios gastos de una vez): la categoría son casillas, se puede marcar más de una y cada una es un
 * BLOQUE con su monto, su descripción y su método de pago (y, en Combustible, el camión, los litros, los km y el tanque lleno). La
 * fecha y el viaje son uno solo para toda la carga. Con UNA categoría marcada (o ninguna) la pantalla es la de siempre: mismo orden,
 * mismos textos, mismos ids y el mismo guardado de UN gasto (`useCrearGasto`); con dos o más se guardan todos juntos en UN solo pedido
 * (`useCrearGastos`: quedan todos o ninguno), cada uno con su propia clave de idempotencia. La edición sigue siendo de UNA categoría.
 *
 * Orden en pantalla: categoría, monto (y el recuadro de Combustible), «¿Cómo pagaste?», fecha y el pliegue «Agregar nota o viaje» (la
 * nota y el viaje). Con varias categorías: los bloques, el grupo «¿Cómo pagaste cada gasto?» y después la fecha y el pliegue compartidos
 * (una nota por categoría y el viaje). La descripción de «Gastos varios» es obligatoria y NO se pliega: «¿En qué gastaste?», arriba,
 * debajo de la categoría. La fecha va plegada («Fecha: hoy» con «Cambiar»): el campo aparece al tocar «Cambiar» o ante un error de la
 * fecha. El pliegue de nota y viaje se ve abierto desde el principio si ya hay algo adentro (un gasto con nota o viaje, un viaje que llega
 * elegido) o se abre con el botón o ante un error de la nota o del viaje. Lo abierto queda abierto. El foco al primer error sigue ese
 * mismo orden (`camposEnOrdenVisual`).
 *
 * Resiliencia (patrón de src/lib/use-submit-feedback.ts):
 *  - El estado de los campos vive acá, en memoria, y NO se limpia si el guardado falla.
 *  - "Reintentar" reenvía el formulario con los mismos valores. En el ALTA el INSERT es
 *    idempotente: un `client_ref` generado al abrir el formulario (uno por categoría si son varias), igual en cada reintento
 *    (ver `crearGasto` y `crearGastos`), así que un reintento tras una respuesta perdida no duplica el gasto.
 *  - Tras guardar, la pantalla queda bloqueada ("Guardando…") hasta que se navega a la lista.
 *  - Tras un intento de guardar VARIOS gastos que NO terminó bien (sin señal, un error), las categorías marcadas quedan FIJAS: si se
 *    pudiera destildar una después, un gasto que sí llegó a guardarse quedaría escondido. Tras un intento de UN gasto se puede CAMBIAR
 *    la categoría (como siempre: el reintento usa la misma clave y `crearGasto` corrige lo ya mandado con un UPDATE, sin duplicar), pero
 *    no sumar otra. Lo escrito se puede seguir corrigiendo y reintentar; la salida para sumar categorías, o en un callejón sin salida,
 *    es "Empezar de nuevo" (claves nuevas y lo mandado olvidado, SIEMPRE juntos: ver `gasto-envio.ts`).
 *
 * Viaje (opcional): el selector ofrece "Sin viaje" y los viajes más recientes (ver `opcionesDeViaje`), y siempre
 * incluye el viaje ya vinculado al gasto que se edita y el preseleccionado. Si la lista no carga, el error con
 * "Reintentar" va junto al campo y NO bloquea el guardado ni toca nada de lo tipeado.
 *
 * Combustible: con la categoría Combustible aparecen el camión, los litros, el km del odómetro y el tanque lleno;
 * el precio por litro NO se tipea, se calcula (monto ÷ litros). Si se cambia a otra categoría,
 * esos campos desaparecen y al guardar se mandan en NULL (también en el UPDATE).
 *
 * Camión (solo Combustible: con litros hace falta camión; ver `decidirCamion`): si el gasto va en un viaje con camión, va
 * ESE camión, bloqueado y visible; si no, con uno solo activo se asigna solo y se muestra ("Camión: AB 123 CD", sin
 * control); con dos o más, una carga NUEVA llega precompletada con el camión activo de la persona (si es válido) y una
 * EDITADA con el que ya tenía: se ve la línea con "Cambiar" (cambia solo esta carga, nunca el camión activo); sin
 * precompletado se elige con un toque; y sin ninguno activo se carga uno ahí mismo ("+ Nuevo camión", solo el
 * administrador). Un gasto que ya tenía un camión archivado lo conserva. Si la lista de camiones no carga, la carga de
 * combustible no se guarda. Al pasar a "Sin viaje" queda elegido el camión del viaje que tenía (B3 de la auditoría de la
 * 5b: va como valor del formulario, así que gana sobre el precompletado). Con varias categorías, al validar va SIEMPRE el camión ya
 * resuelto del bloque de Combustible: sin él, la carga iría sin camión.
 */
export function GastoFormulario({
  categorias,
  gasto,
  volver,
  desdeViaje = null,
  viajePreseleccionado = null,
}: GastoFormularioProps) {
  const navigate = useNavigate();
  const tenantId = useTenantId();
  const editando = gasto !== undefined;

  // Lo que se escribe, repartido según de quién es: lo de cada categoría (`carga`), lo de toda la carga (fecha y viaje) y lo del
  // combustible. Los valores de partida son los de siempre (`valuesFromGasto` al editar, `emptyGastoValues` en un alta).
  const [valoresIniciales] = useState<GastoFormValues>(() =>
    gasto ? valuesFromGasto(gasto) : emptyGastoValues(todayLocal(), viajePreseleccionado?.id ?? ''),
  );
  const [carga, setCarga] = useState<CargaDeGastos>(() =>
    gasto
      ? cargaConUna(valoresIniciales.categoriaId, {
          monto: valoresIniciales.monto,
          descripcion: valoresIniciales.descripcion,
          metodoPago: valoresIniciales.metodoPago,
        })
      : CARGA_VACIA,
  );
  const [fecha, setFecha] = useState(valoresIniciales.fecha);
  // La fecha va plegada («Fecha: hoy» y «Cambiar»): el campo se despliega al tocar «Cambiar» o ante un error de la fecha, y una vez
  // abierto queda abierto (aunque se corrija el error o se vuelva a hoy). Una fecha que no se entiende (la base acepta cosas raras) no se
  // puede resumir en una línea: el campo arranca abierto.
  const [fechaAbierta, setFechaAbierta] = useState(() => !isValidDateString(valoresIniciales.fecha));
  // El pliegue «Agregar nota o viaje» (la nota de cada categoría común y el viaje). `pliegueAbierto` = ya se abrió: con el botón, por un
  // error o porque en algún momento hubo algo adentro (más abajo). Una vez abierto queda abierto, como la fecha.
  const [pliegueAbierto, setPliegueAbierto] = useState(false);
  const [viajeId, setViajeId] = useState(valoresIniciales.viajeId);
  const [combustible, setCombustible] = useState<DatosDeCombustible>({
    camionId: valoresIniciales.camionId,
    litros: valoresIniciales.litros,
    kmOdometro: valoresIniciales.kmOdometro,
    tanqueLleno: valoresIniciales.tanqueLleno,
  });
  const [errores, setErrores] = useState<ErroresDeCarga>(SIN_ERRORES);
  // El id del DOM al que llevar el foco, ya resuelto (depende de lo que se ve): se pide con un contador nuevo cada vez.
  const [focusRequest, setFocusRequest] = useState<{ domId: string; n: number } | null>(null);
  const [gone, setGone] = useState(false);

  // Lo ya mandado a la base y las claves de idempotencia del ALTA (la del gasto único y una por categoría), siempre juntos: ver
  // `gasto-envio.ts`. Se crea la primera vez que hace falta y se REEMPLAZA entero (`reiniciarEnvio`) tras guardar bien y en
  // "Empezar de nuevo": nunca se vacía una parte sin la otra. Solo se toca en manejadores de eventos, nunca al dibujar.
  const envioRef = useRef<EnvioDeLaCarga | null>(null);
  function envio(): EnvioDeLaCarga {
    envioRef.current ??= nuevoEnvio();
    return envioRef.current;
  }

  // Un intento de guardar empezó y NO terminó bien (cualquier error): las categorías quedan limitadas hasta "Empezar de nuevo".
  // Qué se limita depende de qué intento fue:
  //  - 'una': el intento fue de UN gasto. Su clave es una sola y `crearGasto` corrige lo ya mandado con un UPDATE por clave, así que
  //    se puede CAMBIAR la categoría (desmarcar y marcar otra) y reintentar sin duplicar. Lo que no se puede es sumar una segunda:
  //    pasaría al camino de varios, con otras claves, y el gasto del intento anterior (que pudo guardarse) quedaría escondido.
  //  - 'varias': el intento fue el de varios. Las categorías quedan totalmente fijas.
  const [bloqueo, setBloqueo] = useState<'una' | 'varias' | null>(null);
  // Además, lo que falló no se arregla reintentando (el intento anterior fue con otras categorías, o uno de los gastos ya guardados
  // ya no está): guardar de nuevo daría lo mismo y la única salida es "Empezar de nuevo".
  const [sinSalida, setSinSalida] = useState(false);

  // ¿Sigue montada la pantalla? Si el usuario se va (o se cierra la sesión) mientras la escritura está en
  // vuelo, al llegar la respuesta NO se navega: lo arrastraría a Gastos desde donde esté. La invalidación de
  // las queries sí se hace igual (en `onSuccess`, con el tenantId capturado al empezar). Se pone en true en
  // el setup del efecto (no solo en el valor inicial) porque StrictMode monta, desmonta y vuelve a montar.
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const crear = useCrearGasto();
  const crearVarios = useCrearGastos();
  const actualizar = useActualizarGasto();
  const eliminar = useEliminarGasto();

  // Qué categorías están marcadas y cómo se ve la pantalla: con 0 o 1 es la de siempre (UN juego de campos, `claveUnica`); con 2 o más
  // (solo en el alta) hay un bloque por categoría. Los bloques van en el orden de la lista de categorías, no en el de los toques.
  const cantidad = carga.elegidas.length;
  const varias = !editando && cantidad >= 2;
  const claveUnica = cantidad === 1 ? carga.elegidas[0]! : SIN_CATEGORIA;
  const categoriasEnOrden = useMemo(() => sortCategorias(categorias), [categorias]);
  const categoriasElegidas = useMemo(
    () => categoriasEnOrden.filter((categoria) => carga.elegidas.includes(categoria.id)),
    [categoriasEnOrden, carga.elegidas],
  );
  const categoriaUnica = categorias.find((categoria) => categoria.id === claveUnica);

  // «Gastos varios»: su descripción es obligatoria y va SIEMPRE a la vista, arriba («¿En qué gastaste?»). La de las demás categorías (o la
  // de ninguna marcada) es una nota opcional que va en el pliegue «Agregar nota o viaje», junto con el viaje. Estas son las claves de cada uno.
  const clavesDeVarios = varias
    ? categoriasElegidas.filter((categoria) => isGastosVarios(categoria)).map((categoria) => categoria.id)
    : isGastosVarios(categoriaUnica)
      ? [claveUnica]
      : [];
  const clavesConNota = varias
    ? categoriasElegidas.filter((categoria) => !isGastosVarios(categoria)).map((categoria) => categoria.id)
    : isGastosVarios(categoriaUnica)
      ? []
      : [claveUnica];
  // El pliegue se ve abierto si ya se abrió O si tiene algo adentro (derivado de lo escrito y del viaje: un pliegue cerrado no puede
  // esconder datos, ni al editar, ni al llegar desde un viaje, ni cuando una nota pasa a otra categoría).
  const hayDatosAdentro = hayDatosEnElPliegue({ viajeId, notas: clavesConNota.map((clave) => bloqueDe(carga, clave).descripcion) });
  const pliegueVisible = pliegueAbierto || hayDatosAdentro;
  // Lo que se vio abierto queda abierto: se recuerda acá, en un solo lugar, para que no se pliegue bajo el dedo al borrar la nota, al
  // elegir «Sin viaje» o al cambiar de categoría. Es un ajuste de estado durante el render (condicional: React vuelve a dibujar antes de
  // pintar), así no depende de que cada campo o manejador se acuerde de hacerlo.
  if (pliegueVisible && !pliegueAbierto) setPliegueAbierto(true);

  // Con `run` de una vez: el contexto de errores es el de UN gasto o el de varios (que además sabe de "las categorías de antes").
  const { run, pending, lento, error, retryable, clearError } = useSubmitFeedback({
    context: varias ? GUARDAR_LOTE_CONTEXT : GUARDAR_GASTO_CONTEXT,
  });

  // Viajes que se pueden elegir: los recientes + los que tienen que estar sí o sí (el vinculado al gasto, el preseleccionado
  // y el que se acaba de elegir, para que una actualización de la lista no le saque la opción al valor elegido).
  const viajesQuery = useViajesRecientes();
  const [viajeElegido, setViajeElegido] = useState<ViajeOpcion | null>(null);
  const recientes = viajesQuery.data;
  const vinculado = gasto?.viajes ?? null;
  const viajes = useMemo(
    () => opcionesDeViaje({ recientes: recientes ?? [], fijos: [vinculado, viajePreseleccionado, viajeElegido] }),
    [recientes, vinculado, viajePreseleccionado, viajeElegido],
  );
  const today = todayLocal();
  const opcionesViaje = useMemo(
    () => viajes.map((viaje) => ({ value: viaje.id, label: etiquetaDeViaje(viaje, today) })),
    [viajes, today],
  );

  // Solo existe UN bloque de Combustible (una categoría, una vez por carga): `idCombustible` es la clave de sus errores.
  const categoriaCombustible = categoriasElegidas.find((categoria) => isCombustible(categoria));
  const fuel = categoriaCombustible !== undefined;
  const idCombustible = categoriaCombustible?.id ?? null;

  // Camión de la carga de combustible: la lista de camiones (en caché) + los cargados o reactivados acá mismo, que la lista
  // todavía no trae (se refresca en segundo plano). El camión del viaje elegido manda (la base exige que coincidan).
  const { member } = useMember();
  // `fresca`: se vuelve a pedir al abrir el formulario (si no, una lista vieja con 1 solo camión asignaría ese sin mostrar el selector).
  const camionesQuery = useCamiones({ fresca: true });
  // Cada camión cargado o reactivado acá, con el momento de la lista que se tenía al hacerlo (`dataUpdatedAt`): en cuanto la
  // lista se vuelve a leer, ella manda (ver `combinarCamiones`).
  const [camionesCreados, setCamionesCreados] = useState<Array<{ camion: CamionDeLista; listaAl: number }>>([]);
  const [mensajeCamion, setMensajeCamion] = useState<string | null>(null);
  const camionesCargados = camionesQuery.data?.items;
  const listaAl = camionesQuery.dataUpdatedAt;
  const camiones = useMemo(
    () =>
      camionesCargados
        ? combinarCamiones(
            camionesCargados,
            camionesCreados.filter((creado) => creado.listaAl >= listaAl).map((creado) => creado.camion),
          )
        : null,
    [camionesCargados, camionesCreados, listaAl],
  );
  const viajeElegidoOpcion = viajeId === '' ? null : (viajes.find((viaje) => viaje.id === viajeId) ?? null);
  const camionDelViaje = viajeElegidoOpcion?.camion_id ?? null;
  // El camión activo de la persona (Etapa 5c) precompleta solo una carga NUEVA; `decidirCamion` lo valida contra la lista.
  const decisionCamion =
    fuel && camiones
      ? decidirCamion({
          camiones,
          original: gasto?.camion_id ?? null,
          camionDelViaje,
          contexto: 'combustible',
          modo: editando ? 'edicion' : 'nuevo',
          camionActivoId: member?.camionActivoId ?? null,
        })
      : null;
  const resolucionCamion: ResolucionCamion = !fuel
    ? { ok: true, camionId: null }
    : decisionCamion
      ? resolverCamion(decisionCamion, combustible.camionId)
      : { ok: false, message: CAMIONES_SIN_CARGAR_MESSAGE };

  function usarCamionNuevo(camion: CamionDeLista, mensaje: string) {
    setCamionesCreados((previos) => [...previos.filter((previo) => previo.camion.id !== camion.id), { camion, listaAl }]);
    setDatoDelCombustible('camionId', camion.id);
    setMensajeCamion(mensaje);
  }

  const opcionesCategoria = categoriasParaElegir(categorias, gasto?.categoria_id).map((categoria) => ({
    value: categoria.id,
    label: nombreParaMostrar(categoria),
  }));

  // Foco al primer campo con error, después de que se pinte el error. Es un efecto que
  // solo toca el DOM (no hay setState adentro).
  useEffect(() => {
    if (!focusRequest) return;
    const element = document.getElementById(focusRequest.domId);
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'center' }); // centrado: no queda bajo el header fijo
  }, [focusRequest]);

  function pedirFoco(domId: string) {
    setFocusRequest((previous) => ({ domId, n: (previous?.n ?? 0) + 1 }));
  }

  // --- lo que se escribe ---

  function setCampoDelBloque<K extends CampoDelBloque>(clave: string, campo: K, valor: CamposDelBloque[K]) {
    setCarga((previa) => cambiarCampo(previa, clave, campo, valor));
    setErrores((previos) => sinErrorDelBloque(previos, clave, campo));
  }

  function setDatoDelCombustible<K extends keyof DatosDeCombustible>(campo: K, valor: DatosDeCombustible[K]) {
    setCombustible((previo) => ({ ...previo, [campo]: valor }));
    if (idCombustible !== null) setErrores((previos) => sinErrorDelBloque(previos, idCombustible, campo));
  }

  /** «Cambiar»: se reemplaza la fila por el campo y el foco pasa a él (el efecto del foco corre cuando el campo ya existe). */
  function abrirFecha() {
    setFechaAbierta(true);
    pedirFoco(IDS.fecha);
  }

  function handleFechaChange(valor: string) {
    setFecha(valor);
    setErrores((previos) => sinErrorCompartido(previos, 'fecha'));
  }

  /** «Agregar nota o viaje»: se despliega el pliegue y el foco pasa a su primer campo (la primera nota, o el viaje si no hay notas). */
  function abrirPliegue() {
    setPliegueAbierto(true);
    pedirFoco(clavesConNota.length > 0 ? idsDelBloque(varias ? clavesConNota[0]! : null).descripcion : IDS.viaje);
  }

  function handleViajeChange(id: string) {
    setViajeId(id);
    setErrores((previos) => sinErrorCompartido(previos, 'viajeId'));
    setViajeElegido(viajes.find((viaje) => viaje.id === id) ?? null);
    // Se deja el viaje que tenía camión: el camión queda elegido (editable), con el valor que tenía.
    if (camionDelViaje) setDatoDelCombustible('camionId', camionDelViaje);
  }

  // Marcar o desmarcar una categoría (alta): los errores de los bloques que cambian y el del grupo ya no valen (el aviso de
  // "descripción obligatoria" solo vale para "Gastos varios"; si la nueva también la exige, se vuelve a validar al guardar).
  function handleCategoriaToggle(categoriaId: string) {
    // Las casillas ya vienen apagadas en estos casos; esto es por si algo llegara hasta acá igual (defensa en profundidad).
    if (pending || bloqueo === 'varias') return;
    // Tras un intento de UN gasto se puede cambiar la categoría, pero no llegar a 2 o más marcadas.
    if (bloqueo === 'una' && !carga.elegidas.includes(categoriaId) && carga.elegidas.length >= 1) return;
    setCarga((previa) => alternarCategoria(previa, categoriaId));
    setErrores((previos) => sinErroresDeBloques(sinErrorDeCategoria(previos), [categoriaId, SIN_CATEGORIA]));
  }

  // Cambiar la categoría de un gasto que se edita (una sola): lo escrito pasa a la nueva.
  function handleCategoriaUnica(categoriaId: string) {
    setCarga((previa) => elegirUnica(previa, categoriaId));
    setErrores((previos) => sinErroresDeBloques(sinErrorDeCategoria(previos), [categoriaId, SIN_CATEGORIA, ...carga.elegidas]));
  }

  // --- guardar ---

  function mostrarErrores(nuevos: ErroresDeCarga, disposicion: 'una' | 'varias', claves: readonly string[]) {
    setErrores(nuevos);
    // Un error de la fecha nunca queda escondido en la fila plegada: se abre el campo en el MISMO ciclo que se pinta el error (todo
    // esto va junto en un solo render), así cuando corre el efecto del foco el campo ya existe.
    if (nuevos.compartidos.fecha !== undefined) setFechaAbierta(true);
    // Lo mismo con el pliegue «Agregar nota o viaje»: un error del viaje o de una nota (p. ej. de largo) lo abre en este mismo render. Con
    // la validación de hoy esos errores implican algo adentro (ya se vería abierto); esto lo garantiza igual si la validación cambia.
    if (
      nuevos.compartidos.viajeId !== undefined ||
      clavesConNota.some((clave) => Object.hasOwn(nuevos.bloques, clave) && nuevos.bloques[clave]!.descripcion !== undefined)
    ) {
      setPliegueAbierto(true);
    }
    // El foco va al PRIMER error en el orden en que se ven los campos (el método de pago antes que la fecha, la nota y el viaje; con varias
    // categorías, los de todos los bloques juntos; la descripción de «Gastos varios» arriba, la nota de las demás en el pliegue).
    const puesto = primerErrorVisual(nuevos, disposicion, claves, clavesDeVarios);
    if (puesto) pedirFoco(idDelPuesto(puesto, disposicion === 'varias', decisionCamion));
  }

  /** Tras guardar bien: UN solo reinicio (lo mandado y las claves, juntos) y recién ahí se navega. */
  function terminarBien(fechaDeLaCarga: string, cantidadGuardada: number) {
    envioRef.current = reiniciarEnvio();
    if (desdeViaje) {
      // Se abrió desde el detalle de un viaje: se vuelve a ESE viaje. La ruta se arma acá con un uuid ya validado.
      navigate(rutaDelViaje(desdeViaje.id), {
        replace: true,
        state: {
          ...(cantidadGuardada >= 2
            ? { aviso: 'gastos-guardados' satisfies DetalleAviso, cantidad: cantidadGuardada }
            : { aviso: 'gasto-guardado' satisfies DetalleAviso }),
          volver: desdeViaje.volver,
          ...estadoDesdeCliente(desdeViaje.cliente),
        },
      });
      return;
    }
    // A la lista del mes del gasto (si es de otro mes, así se ve que quedó guardado).
    navigate(`/gastos${searchDelMesDeFecha(fechaDeLaCarga)}`, {
      replace: true,
      state:
        cantidadGuardada >= 2
          ? { aviso: 'guardados' satisfies GastoAviso, cantidad: cantidadGuardada }
          : { aviso: 'guardado' satisfies GastoAviso },
    });
  }

  /** Varios gastos de una vez (alta con 2 o más categorías): UN solo pedido, una clave por categoría. */
  async function guardarVarios() {
    // La pantalla no deja llegar acá sin 2 a `MAX_GASTOS_POR_CARGA` categorías distintas (el grupo se apaga en el tope y cada
    // categoría se marca una vez): `validateLoteDeGastos` lo rechazaría con una excepción.
    if (categoriasElegidas.length < 2 || categoriasElegidas.length > MAX_GASTOS_POR_CARGA) return;

    const bloques: BloqueDeGasto[] = categoriasElegidas.map((categoria) => {
      const bloque = bloqueDe(carga, categoria.id);
      return {
        categoriaId: categoria.id,
        monto: bloque.monto,
        descripcion: bloque.descripcion,
        metodoPago: bloque.metodoPago,
        litros: combustible.litros,
        kmOdometro: combustible.kmOdometro,
        tanqueLleno: combustible.tanqueLleno,
        // SIEMPRE el camión ya resuelto: sin él, la carga de combustible iría sin camión (solo la usa el bloque de Combustible).
        camion: resolucionCamion,
      };
    });
    const validacion = validateLoteDeGastos({ fecha, viajeId }, bloques, { categorias, today: todayLocal(), viajes });
    if (!validacion.ok) {
      mostrarErrores(erroresDelLote(validacion), 'varias', categoriasElegidas.map((categoria) => categoria.id));
      return;
    }
    setErrores(SIN_ERRORES);

    const envioActual = envio();
    const items: GastoParaGuardar[] = validacion.gastos.map(({ categoriaId, columns }) => ({
      columns,
      clientRef: claveDeCategoria(envioActual, categoriaId),
    }));

    const intento = { empezo: false, sinSalida: false };
    const result = await run<ResultadoGuardado>(async () => {
      intento.empezo = true;
      try {
        await crearVarios.mutateAsync({ tenantId, items, sent: envioActual.sent });
      } catch (failure) {
        // Lo que no se arregla reintentando: el intento anterior fue con otras categorías, o uno de los gastos ya guardados ya no está.
        if (failure instanceof LoteDeGastosDistintoError || failure instanceof RecordNotFoundError) intento.sinSalida = true;
        throw failure;
      }
      return 'listo';
    });

    if (!result.ok) {
      // El intento empezó y no terminó bien (el error ya se muestra en la SubmitBar, sin tocar los campos). Con 'varias' las categorías
      // quedan totalmente fijas; con 'una' se puede cambiar la categoría (desmarcar la actual y marcar otra) pero no sumar otra.
      if (intento.empezo) setBloqueo('varias');
      if (intento.sinSalida) setSinSalida(true);
      return;
    }
    if (!mountedRef.current) return; // se fue de la pantalla mientras guardaba: no arrastrarlo a la lista
    terminarBien(validacion.gastos[0]!.columns.fecha, validacion.gastos.length);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (varias) {
      await guardarVarios();
      return;
    }

    // UN solo gasto (la edición, o un alta con una categoría o ninguna): el camino de siempre.
    const values: GastoFormValues = { categoriaId: claveUnica, ...bloqueDe(carga, claveUnica), fecha, viajeId, ...combustible };
    const validation = validateGastoForm(values, { categorias, today: todayLocal(), viajes, camion: resolucionCamion });
    if (!validation.ok) {
      mostrarErrores(erroresDeUnGasto(claveUnica, validation.errors), 'una', [claveUnica]);
      return;
    }
    setErrores(SIN_ERRORES);
    const { columns } = validation;

    const envioActual = envio();
    const intento = { empezo: false };
    const result = await run<ResultadoGuardado>(async () => {
      if (gasto) {
        try {
          await actualizar.mutateAsync({ tenantId, id: gasto.id, changes: columns });
        } catch (failure) {
          // 0 filas: el gasto ya no existe. No es un error que se arregle reintentando.
          if (failure instanceof RecordNotFoundError) return 'no-encontrado';
          throw failure;
        }
        return 'listo';
      }
      intento.empezo = true;
      // `crearGasto` trata "ya estaba guardado" (23505 del client_ref) como éxito.
      await crear.mutateAsync({ tenantId, columns, clientRef: envioActual.clave, sent: envioActual.sent });
      return 'listo';
    });

    if (!result.ok) {
      // El intento empezó y no terminó bien (el error ya se muestra en la SubmitBar, sin tocar los campos). Con 'varias' las categorías
      // quedan totalmente fijas; con 'una' se puede cambiar la categoría (desmarcar la actual y marcar otra) pero no sumar otra.
      if (intento.empezo) setBloqueo('una');
      return;
    }
    if (!mountedRef.current) return; // se fue de la pantalla mientras guardaba: no arrastrarlo a la lista
    if (result.data === 'no-encontrado') {
      setGone(true);
      return;
    }

    if (editando) {
      if (desdeViaje) {
        // Se abrió desde el detalle de un viaje: se vuelve a ESE viaje. La ruta se arma acá con un uuid ya validado.
        navigate(rutaDelViaje(desdeViaje.id), {
          replace: true,
          state: { aviso: 'gasto-guardado' satisfies DetalleAviso, volver: desdeViaje.volver, ...estadoDesdeCliente(desdeViaje.cliente) },
        });
        return;
      }
      // A la lista del mes del gasto (si es de otro mes, así se ve que quedó guardado).
      navigate(`/gastos${searchDelMesDeFecha(columns.fecha)}`, { replace: true, state: { aviso: 'guardado' satisfies GastoAviso } });
      return;
    }
    terminarBien(columns.fecha, 1);
  }

  /** «Empezar de nuevo»: UN solo reinicio (lo mandado y las claves, juntos); las categorías se pueden volver a elegir y lo escrito se conserva. */
  function empezarDeNuevo() {
    if (pending) return; // el botón ya está apagado mientras guarda; esto es por si algo llegara hasta acá igual
    envioRef.current = reiniciarEnvio();
    setBloqueo(null);
    setSinSalida(false);
    clearError();
    pedirFoco(`${IDS.categoria}-0`);
  }

  if (gone) return <GastoNoEncontrado volver={volver} />;

  // --- lo que se ve ---

  /**
   * La descripción de un bloque. Dos lugares, según la categoría:
   *  - «Gastos varios»: «¿En qué gastaste?», obligatoria y SIEMPRE a la vista, justo debajo de la categoría (o del título de su bloque).
   *  - las demás: una nota opcional que vive en el pliegue «Agregar nota o viaje». Con una sola categoría se llama «Descripción» (como
   *    siempre); con varias, «Nota de Peajes», para saber de cuál es.
   * El id es el de siempre en los dos casos (`gasto-descripcion`, o `gasto-descripcion-<categoría>` con varias): nunca están los dos a la vez.
   */
  function campoDescripcion(clave: string, categoria: Categoria | undefined, enVarias: boolean) {
    const bloque = bloqueDe(carga, clave);
    const delBloque = Object.hasOwn(errores.bloques, clave) ? errores.bloques[clave]! : {};
    // "Gastos varios": la descripción es obligatoria (ver `validateGastoForm`).
    const esVarios = categoria !== undefined && isGastosVarios(categoria);
    // Con tope: un texto enorme pegado no se recorre entero en cada render.
    const descripcionLength = charLength(bloque.descripcion, MAX_DESCRIPCION);
    return (
      <TextareaField
        id={idsDelBloque(enVarias ? clave : null).descripcion}
        label={esVarios ? ETIQUETA_EN_QUE_GASTASTE : enVarias ? etiquetaDeNota(nombreParaMostrar(categoria!)) : ETIQUETA_DESCRIPCION}
        optional={!esVarios}
        value={bloque.descripcion}
        onChange={(value) => setCampoDelBloque(clave, 'descripcion', value)}
        hint={
          descripcionLength > MAX_DESCRIPCION
            ? `Más de ${MAX_DESCRIPCION} caracteres: acórtala.`
            : descripcionLength >= DESCRIPCION_COUNTER_FROM
              ? `${descripcionLength} de ${MAX_DESCRIPCION} caracteres`
              : esVarios
                ? AYUDA_EN_QUE_GASTASTE
                : undefined
        }
        error={delBloque.descripcion}
      />
    );
  }

  /** «¿En qué gastaste?» (solo «Gastos varios»), monto y, en Combustible, su recuadro: lo que lleva cada bloque. La nota de las demás va en el pliegue. */
  function camposDelBloque(clave: string, categoria: Categoria | undefined, enVarias: boolean) {
    const ids = idsDelBloque(enVarias ? clave : null);
    const bloque = bloqueDe(carga, clave);
    const delBloque = Object.hasOwn(errores.bloques, clave) ? errores.bloques[clave]! : {};
    const esCombustible = categoria !== undefined && isCombustible(categoria);
    const esVarios = categoria !== undefined && isGastosVarios(categoria);
    const precioPorLitro = esCombustible ? previewPrecioPorLitro(bloque.monto, combustible.litros) : null;

    return (
      <>
        {/* Justo debajo de la categoría: en "Gastos varios" (la categoría más ambigua) dice de qué se trata el gasto y es obligatoria, así
            que no se pliega. */}
        {esVarios ? campoDescripcion(clave, categoria, enVarias) : null}

        <NumberField
          id={ids.monto}
          label="Monto"
          kind="dinero"
          value={bloque.monto}
          onChange={(value) => setCampoDelBloque(clave, 'monto', value)}
          error={delBloque.monto}
        />

        {esCombustible ? (
          <div className="space-y-5 rounded-lg border border-border bg-card p-4">
            <p className="text-base font-semibold">{enVarias ? TITULO_DATOS_DEL_COMBUSTIBLE : 'Combustible'}</p>
            <CamionSelector
              id={ids.camion}
              decision={decisionCamion}
              value={combustible.camionId}
              onChange={(camionId) => setDatoDelCombustible('camionId', camionId)}
              error={delBloque.camionId}
              carga={{
                estado: camionesCargados ? 'listo' : camionesQuery.isError ? 'error' : 'cargando',
                error: camionesQuery.error,
                reintentando: camionesQuery.isFetching,
                onReintentar: () => void camionesQuery.refetch(),
              }}
              esAdmin={member?.rol === 'admin'}
              esElPrimero={camiones !== null && camiones.length === 0}
              onCamionListo={usarCamionNuevo}
            />
            {/* Lo que pasó al cargar o reactivar un camión desde acá (p. ej. cuántos registros sin camión se le asignaron). */}
            <p role="status" aria-live="polite" className={mensajeCamion ? 'text-base font-medium' : 'sr-only'}>
              {mensajeCamion ?? ''}
            </p>
            <NumberField
              id={ids.litros}
              label="Litros"
              kind="litros"
              unit="L"
              value={combustible.litros}
              onChange={(value) => setDatoDelCombustible('litros', value)}
              error={delBloque.litros}
            />
            {/* Solo con datos (monto y litros válidos): sin ellos no se muestra nada, en vez de un "—" con una explicación. */}
            {precioPorLitro !== null ? (
              <p className="text-base">
                Sale a <span className="font-semibold tabular-nums">{formatMoney(precioPorLitro)}</span> el litro
              </p>
            ) : null}
            <NumberField
              id={ids.km}
              label="Kilómetros del camión"
              kind="km"
              allowZero
              optional
              unit="km"
              hint="Los km totales que marca el tablero. Sirven para saber cuánto rinde."
              value={combustible.kmOdometro}
              onChange={(value) => setDatoDelCombustible('kmOdometro', value)}
              error={delBloque.kmOdometro}
            />
            <ChoiceGroup
              id={ids.tanque}
              legend="¿Llenaste el tanque?"
              optional
              columns={3}
              value={combustible.tanqueLleno}
              onChange={(value) => setDatoDelCombustible('tanqueLleno', value as TanqueLlenoChoice)}
              options={TANQUE_OPTIONS}
              hint="Con tanque lleno se puede calcular el rendimiento (km por litro)."
              error={delBloque.tanqueLleno}
            />
          </div>
        ) : null}
      </>
    );
  }

  /**
   * El método de pago de un bloque: 4 botones grandes en cuadrícula de 2×2 (un toque, sin abrir lista), SIN ninguno marcado de entrada.
   * Si no entran dos columnas de al menos 9,75 rem (pantalla angosta o letra grande del teléfono) se apilan en una sola columna:
   * «Transferencia» no entra en un botón más angosto y se cortaría a mitad de palabra.
   * Con una categoría la leyenda es «¿Cómo pagaste?»; con varias lleva el nombre de la categoría («¿Cómo pagaste Combustible?») y el
   * id del grupo lleva el de su categoría, así los botones de un gasto no se repiten con los de otro.
   */
  function campoMetodoDePago(clave: string, leyenda: string, enVarias: boolean) {
    const delBloque = Object.hasOwn(errores.bloques, clave) ? errores.bloques[clave]! : {};
    return (
      <ChoiceGroup
        id={idsDelBloque(enVarias ? clave : null).metodo}
        legend={leyenda}
        value={bloqueDe(carga, clave).metodoPago}
        onChange={(value) => {
          // Solo valores de la lista (los 4 botones): cualquier otra cosa no entra al formulario.
          const metodo = METODO_PAGO_ORDER.find((candidato) => candidato === value);
          if (metodo !== undefined) setCampoDelBloque(clave, 'metodoPago', metodo);
        }}
        options={METODO_PAGO_OPTIONS}
        columns={2}
        apilarEnAngosto
        error={delBloque.metodoPago}
      />
    );
  }

  // La fecha: casi siempre es la de hoy, así que va plegada en una fila («Fecha: hoy» y «Cambiar»). Con «Cambiar» (o ante un error de la
  // fecha) se reemplaza por el campo de siempre, con el mismo id, los mismos límites y el mismo error. Es una sola para toda la carga.
  const campoFecha = fechaAbierta ? (
    <DateField
      id={IDS.fecha}
      label="Fecha"
      min={MIN_FECHA}
      max={today}
      value={fecha}
      onChange={handleFechaChange}
      error={errores.compartidos.fecha}
    />
  ) : (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <p id={`${IDS.fecha}-linea`} className="text-base">
        {ROTULO_FECHA} <span className="font-semibold">{textoDeLaFecha(fecha, today)}</span>
      </p>
      <Button type="button" variant="outline" aria-label={NOMBRE_CAMBIAR_FECHA} onClick={abrirFecha}>
        {BOTON_CAMBIAR_FECHA}
      </Button>
    </div>
  );

  const campoViaje = (
    <div className="space-y-2">
      <SelectField
        id={IDS.viaje}
        label="Viaje"
        optional
        placeholder="Sin viaje"
        options={opcionesViaje}
        value={viajeId}
        onChange={handleViajeChange}
        hint={
          viajesQuery.isPending
            ? 'Cargando viajes…'
            : (recientes?.length ?? 0) >= RECIENTES_LIMIT
              ? `Se muestran los ${RECIENTES_LIMIT} viajes más recientes.`
              : undefined
        }
        error={errores.compartidos.viajeId}
      />
      {/* Solo si NO hay lista: un refresco fallido con la lista ya cargada no molesta. No bloquea el guardado. */}
      {viajesQuery.isError && recientes === undefined ? (
        <InlineError
          message={`No pudimos cargar los viajes. ${mapDataError(viajesQuery.error)}`}
          onRetry={() => void viajesQuery.refetch()}
          retrying={viajesQuery.isFetching}
        />
      ) : null}
    </div>
  );

  // El pliegue «Agregar nota o viaje»: la nota de cada categoría común y el viaje, que casi nunca se completan. Plegado es SOLO un botón de
  // ancho completo; desplegado (a propósito, por un error o porque ya hay algo adentro) quedan los campos de siempre, con sus ids, y el
  // botón desaparece. La región (`gasto-pliegue`) está siempre en la página, oculta mientras está plegada, así el `aria-controls` del
  // botón apunta a un elemento que existe; su contenido solo se dibuja desplegado (no hay campos ocultos ni ids repetidos).
  const pliegue = (
    <>
      <div id={IDS.pliegue} hidden={!pliegueVisible} className="space-y-5">
        {pliegueVisible ? (
          <>
            {clavesConNota.map((clave) => (
              <div key={clave}>{campoDescripcion(clave, categorias.find((categoria) => categoria.id === clave), varias)}</div>
            ))}
            {campoViaje}
          </>
        ) : null}
      </div>
      {!pliegueVisible ? (
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-12 w-full whitespace-normal py-2"
          aria-expanded="false"
          aria-controls={IDS.pliegue}
          onClick={abrirPliegue}
        >
          <Plus aria-hidden="true" />
          {textoDelPliegue(clavesConNota.length)}
        </Button>
      ) : null}
    </>
  );

  // La categoría: en la edición, UNA opción (como siempre); en el alta, casillas (una o más).
  const grupoDeCategorias = editando ? (
    <ChoiceGroup
      id={IDS.categoria}
      legend="Categoría"
      value={claveUnica}
      onChange={handleCategoriaUnica}
      options={opcionesCategoria}
      error={errores.categoria}
    />
  ) : (
    <MultiChoiceGroup
      id={IDS.categoria}
      legend="Categoría"
      value={carga.elegidas}
      onToggle={(categoriaId) => handleCategoriaToggle(categoriaId)}
      options={opcionesCategoria}
      error={errores.categoria}
      // Mientras guarda y, tras un intento de VARIOS que no terminó bien, hasta "Empezar de nuevo". Tras un intento de UN gasto no se
      // apaga todo: el grupo queda "una sola a la vez" (`max={1}`: con una marcada se apagan las demás; al desmarcarla vuelven).
      disabled={pending || bloqueo === 'varias'}
      max={bloqueo === 'una' ? 1 : MAX_GASTOS_POR_CARGA}
      // El aviso del tope de 10 es solo del tope de 10: con `max={1}` lo explica la línea de abajo.
      maxMessage={bloqueo === 'una' ? undefined : AVISO_TOPE_DE_CATEGORIAS}
      hint={
        <>
          {AYUDA_VARIAS_CATEGORIAS}
          {bloqueo !== null ? (
            <span className="mt-1 block font-medium">{bloqueo === 'una' ? AVISO_CATEGORIA_CAMBIABLE : AVISO_CATEGORIAS_FIJAS}</span>
          ) : null}
        </>
      }
    />
  );

  return (
    <div className="space-y-8">
      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-5">
        {grupoDeCategorias}

        {varias ? (
          <>
            {/* Un bloque por categoría marcada, en el orden de la lista de categorías. */}
            {categoriasElegidas.map((categoria) => {
              const ids = idsDelBloque(categoria.id);
              return (
                <div key={categoria.id} role="group" aria-labelledby={ids.titulo} className="space-y-5 border-t border-border pt-5">
                  <h2 id={ids.titulo} className="break-words text-lg font-semibold">
                    {nombreParaMostrar(categoria)}
                  </h2>
                  {camposDelBloque(categoria.id, categoria, true)}
                </div>
              );
            })}

            {/* El método de pago es de cada gasto: uno por categoría, juntos, ANTES de la fecha y el viaje. */}
            <div role="group" aria-labelledby="gasto-metodos-titulo" className="space-y-5 border-t border-border pt-5">
              <h2 id="gasto-metodos-titulo" className="text-lg font-semibold">
                {TITULO_COMO_PAGASTE}
              </h2>
              {categoriasElegidas.map((categoria) => (
                <div key={categoria.id}>{campoMetodoDePago(categoria.id, etiquetaMetodoDePago(nombreParaMostrar(categoria)), true)}</div>
              ))}
            </div>

            {/* La fecha y el viaje son uno solo para todos los gastos. El viaje y las notas de las categorías (menos «Gastos varios», que
                tiene su pregunta arriba) van todos en UN solo pliegue, después de la fecha. */}
            <div className="space-y-5 border-t border-border pt-5">
              {campoFecha}
              {pliegue}
            </div>
          </>
        ) : (
          <>
            {camposDelBloque(claveUnica, categoriaUnica, false)}
            {campoMetodoDePago(claveUnica, LEYENDA_COMO_PAGASTE, false)}
            {campoFecha}
            {pliegue}
          </>
        )}

        {/* Avisa a lectores de pantalla que aparecieron los campos de combustible. */}
        <p role="status" className="sr-only">
          {fuel ? 'Se agregaron los campos de combustible: litros, kilómetros del camión y tanque lleno.' : ''}
        </p>

        {/* Avisa a lectores de pantalla cuántos gastos se van a guardar y de qué categorías, al marcar o desmarcar. */}
        <p role="status" aria-live="polite" className="sr-only">
          {editando ? '' : anuncioDeGastos(categoriasElegidas.map((categoria) => nombreParaMostrar(categoria)))}
        </p>

        {!editando && bloqueo !== null ? <EmpezarDeNuevo onConfirmar={empezarDeNuevo} deshabilitado={pending} /> : null}

        <SubmitBar
          pending={pending}
          lento={lento}
          error={error}
          retryable={retryable}
          label={varias ? botonGuardarGastos(cantidad) : 'Guardar gasto'}
          disabled={sinSalida}
        />
      </form>

      {gasto ? (
        <div className="border-t border-border pt-6">
          <ConfirmDelete
            label="Eliminar gasto"
            context={ELIMINAR_GASTO_CONTEXT}
            prompt={textoPreguntaEliminar(gasto, categorias)}
            onConfirm={async () => {
              // 0 filas borradas = ya no estaba: para un borrado es lo mismo que éxito.
              await eliminar.mutateAsync({ tenantId, id: gasto.id });
              if (!mountedRef.current) return; // se fue de la pantalla mientras borraba
              if (desdeViaje) {
                navigate(rutaDelViaje(desdeViaje.id), {
                  replace: true,
                  state: {
                    aviso: 'gasto-eliminado' satisfies DetalleAviso,
                    volver: desdeViaje.volver,
                    ...estadoDesdeCliente(desdeViaje.cliente),
                  },
                });
                return;
              }
              navigate(`/gastos${volver}`, { replace: true, state: { aviso: 'eliminado' satisfies GastoAviso } });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
