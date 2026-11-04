import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { mensajeDeError } from '../../lib/errors';
import { format, fromRow } from '../../lib/money';
import type { CurrencyCode, Money } from '../../lib/money';
import { multiplyByQuantity } from '../../lib/money';
import { requireSupabase } from '../../lib/supabase';
import { Aviso, Boton, Campo, Selector } from '../../components/ui';

export type Costo = {
  id: string;
  quote_line_id: string;
  label: string | null;
  cost_item_id: string | null;
  quantity: number;
  unit_cost: number;
  unit: string;
};

/**
 * Los costos de una línea de cotización.
 *
 * Al elegir un ítem del catálogo se copia su costo del momento en vez de
 * apuntar a él. Es la misma decisión de siempre en este proyecto: si mañana
 * le subes el sueldo a un diseñador, la cotización que ya enviaste sigue
 * diciendo lo que decía. Por eso el costo queda editable después de traerlo.
 */
export default function LineaCostos({
  lineaId,
  organizacionId,
  moneda,
  costos,
  alCambiar,
}: {
  lineaId: string;
  organizacionId: string;
  moneda: CurrencyCode;
  costos: Costo[];
  alCambiar: () => void;
}) {
  const [itemId, setItemId] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [cantidad, setCantidad] = useState('1');
  const [unitario, setUnitario] = useState('');
  const [unidad, setUnidad] = useState('hora');

  const catalogo = useQuery({
    queryKey: ['costos', organizacionId],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('cost_items')
        .select('id, name, unit, unit_cost, currency_code, is_active')
        .eq('organization_id', organizacionId)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  // Elegir un ítem rellena los campos, y a partir de ahí se pueden tocar:
  // esta cotización puede tener un precio distinto al del catálogo.
  function elegirItem(id: string) {
    setItemId(id);
    const item = (catalogo.data ?? []).find((c) => c.id === id);
    if (!item) return;
    setEtiqueta(item.name);
    setUnidad(item.unit);
    setUnitario(String(item.unit_cost));
  }

  const agregar = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase()
        .from('quote_line_costs')
        .insert({
          organization_id: organizacionId,
          quote_line_id: lineaId,
          cost_item_id: itemId || null,
          label: etiqueta.trim() || null,
          quantity: Number(cantidad.replace(',', '.')),
          unit_cost: Number(unitario.replace(',', '.')),
          unit: unidad.trim() || 'unidad',
          sort: costos.length * 10 + 10,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      setItemId('');
      setEtiqueta('');
      setCantidad('1');
      setUnitario('');
      alCambiar();
    },
  });

  const quitar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await requireSupabase()
        .from('quote_line_costs')
        .update({ is_active: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: alCambiar,
  });

  const importe = (c: Costo): Money =>
    multiplyByQuantity(fromRow(c.unit_cost, moneda), String(c.quantity));

  return (
    <div className="mt-2 rounded-control bg-surface-2 p-3">
      {costos.length === 0 ? (
        <p className="text-sm text-muted">
          Sin costos cargados: el margen de esta línea sale 100 %, que casi nunca es verdad.
        </p>
      ) : (
        <ul className="mb-3 flex flex-col gap-1 text-sm">
          {costos.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3">
              <span>{c.label ?? 'Ítem del catálogo'}</span>
              <span className="flex items-center gap-3">
                <span className="num text-muted">
                  {String(c.quantity)} {c.unit} × {format(fromRow(c.unit_cost, moneda))}
                </span>
                <span className="num">{format(importe(c))}</span>
                <Boton
                  variante="sutil"
                  className="min-h-0 px-2 py-1 text-xs"
                  disabled={quitar.isPending}
                  onClick={() => quitar.mutate(c.id)}
                >
                  Quitar
                </Boton>
              </span>
            </li>
          ))}
        </ul>
      )}

      {quitar.error && <Aviso tipo="error">{mensajeDeError(quitar.error)}</Aviso>}

      <form
        className="flex flex-col gap-3 border-t border-border pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          agregar.mutate();
        }}
      >
        <Selector
          etiqueta="Traer del catálogo (opcional)"
          value={itemId}
          onChange={(e) => elegirItem(e.target.value)}
          ayuda="Rellena los campos con su costo de hoy. Después puedes cambiarlos: lo que se guarda es lo de esta cotización."
        >
          <option value="">Escribirlo a mano</option>
          {(catalogo.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.unit_cost} {c.currency_code}/{c.unit}
            </option>
          ))}
        </Selector>

        <Campo
          etiqueta="Concepto"
          value={etiqueta}
          onChange={(e) => setEtiqueta(e.target.value)}
          required
          maxLength={160}
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <Campo
            etiqueta="Cantidad"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            required
          />
          <Campo
            etiqueta="Unidad"
            value={unidad}
            onChange={(e) => setUnidad(e.target.value)}
            maxLength={40}
          />
          <Campo
            etiqueta={`Costo unitario (${moneda})`}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={unitario}
            onChange={(e) => setUnitario(e.target.value)}
            required
          />
        </div>

        {agregar.error && <Aviso tipo="error">{mensajeDeError(agregar.error)}</Aviso>}

        <Boton
          type="submit"
          variante="secundario"
          disabled={agregar.isPending || !etiqueta.trim() || unitario.trim() === ''}
        >
          {agregar.isPending ? 'Añadiendo…' : 'Añadir costo'}
        </Boton>
      </form>
    </div>
  );
}
