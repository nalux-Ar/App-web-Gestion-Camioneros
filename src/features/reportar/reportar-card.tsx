import { Link } from 'react-router';
import { MessageCircleWarning } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RUTA_REPORTAR, TARJETA_BOTON, TARJETA_DESCRIPCION, TARJETA_TITULO } from './reportar-textos';

/** Tarjeta "Reportar un problema" de Configuración (el mismo estilo que la de Camiones): lleva a `/reportar`. */
export function ReportarCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{TARJETA_TITULO}</CardTitle>
        <CardDescription>{TARJETA_DESCRIPCION}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link to={RUTA_REPORTAR}>
            <MessageCircleWarning aria-hidden="true" /> {TARJETA_BOTON}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
