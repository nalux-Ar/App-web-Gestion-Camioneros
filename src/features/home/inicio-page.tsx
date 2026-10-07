import { Link } from 'react-router';

import { Card, CardContent } from '@/components/ui/card';
import { CargarCamionCard } from '@/features/camiones/cargar-camion-card';
import { useMember } from '@/features/member/use-member';
import { PRIMARY_NAV_ITEMS } from '@/features/layout/nav-items';

/** Accesos grandes a las secciones de uso diario (todo menos "Inicio",
 *  donde ya estamos). Tarjetas grandes en vez de una lista chica: el
 *  público usa el celular en ruta, mejor apuntar y tocar que leer fino. */
export function InicioPage() {
  const { member } = useMember();
  const accesos = PRIMARY_NAV_ITEMS.filter((item) => item.to !== '/');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="break-words text-2xl font-semibold">
          Hola{member?.transportistaNombre ? `, ${member.transportistaNombre}` : ''}
        </h1>
        <p className="text-muted-foreground">¿Qué quieres hacer hoy?</p>
      </div>
      {/* Solo mientras la cuenta no tiene ningún camión (y solo para el administrador). */}
      <CargarCamionCard />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {accesos.map((item) => (
          <Link key={item.to} to={item.to}>
            <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent">
              <CardContent className="flex flex-col items-center justify-center gap-2 p-6 text-center">
                <item.icon className="size-8 text-primary" aria-hidden="true" />
                <span className="font-medium">{item.label}</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
