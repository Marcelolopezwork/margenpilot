import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMonedasHabilitadas } from '../../app/consultas';
import { useOrg, useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { nombreTipoCuenta } from '../../lib/format';
import { requireSupabase } from '../../lib/supabase';
import { Constants } from '../../types/database';
import type { Enums } from '../../types/database';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Vacio } from '../../components/ui';
import { Alta, Fila, Lista, Seccion } from './piezas';
import { useRecargar } from './recargar';

export default function Cuentas() {
  const { organizacion, entidad } = useOrgElegida();
  const { entidades } = useOrg();
  const monedas = useMonedasHabilitadas(organizacion.id);
  const recargar = useRecargar(['cuentas']);

  const [exito, setExito] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [entidadId, setEntidadId] = useState('');
  const [moneda, setMoneda] = useState('');
  const [tipo, setTipo] = useState<Enums<'account_kind'>>('bank');
  const [banco, setBanco] = useState('');
  const [ultimos, setUltimos] = useState('');

  const consulta = useQuery({
    queryKey: ['cuentas', organizacion.id, entidad?.id ?? null],
    queryFn: async () => {
      let q = requireSupabase()
        .from('cash_accounts')
        .select(
          'id, name, kind, currency_code, bank_name, account_ref_masked, is_active, legal_entity_id',
        )
        .eq('organization_id', organizacion.id)
        .order('name');
      if (entidad) q = q.eq('legal_entity_id', entidad.id);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const crear = useMutation({
    onMutate: () => setExito(null),
    mutationFn: async () => {
      const { error } = await requireSupabase()
        .from('cash_accounts')
        .insert({
          organization_id: organizacion.id,
          legal_entity_id: entidadId,
          name: nombre.trim(),
          kind: tipo,
          currency_code: moneda,
          bank_name: banco.trim() || null,
          account_ref_masked: ultimos.trim() || null,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      setExito(`${nombre.trim()} queda creada en ${moneda}. Esa moneda ya no se puede cambiar.`);
      setNombre('');
      setBanco('');
      setUltimos('');
      recargar();
    },
  });

  const alternar = useMutation({
    mutationFn: async ({ id, activa }: { id: string; activa: boolean }) => {
      const { error } = await requireSupabase()
        .from('cash_accounts')
        .update({ is_active: !activa })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: recargar,
  });

  const nombreEntidad = (id: string) =>
    entidades.find((e) => e.id === id)?.legal_name ?? 'Entidad desconocida';

  const cuentas = consulta.data ?? [];
  const disponibles = monedas.data ?? [];
  const activas = entidades.filter((e) => e.is_active);
  const puedeCrear = activas.length > 0 && disponibles.length > 0;

  return (
    <Seccion
      titulo="Cuentas de caja"
      regla="Una cuenta, una moneda y una entidad. Si tu banco te da una cuenta multimoneda, aquí son dos cuentas: registrar un movimiento en una moneda distinta a la de su cuenta es imposible, y eso está en un disparador, no en un aviso. Del número de cuenta se guardan solo los últimos dígitos; el número completo no se almacena en ninguna tabla ni en ningún registro."
    >
      {consulta.isPending && <Cargando que="las cuentas" />}
      {consulta.error && <Aviso tipo="error">{mensajeDeError(consulta.error)}</Aviso>}

      {!puedeCrear && !monedas.isPending && (
        <Vacio
          titulo="Faltan dos cosas antes de abrir una cuenta"
          explicacion="Una cuenta necesita una entidad legal a la que pertenecer y una moneda habilitada en la organización. Sin las dos, no hay cuenta posible."
          siguiente={
            activas.length === 0
              ? 'Empieza creando una entidad en la pestaña Entidades.'
              : 'Habilita al menos una moneda en la pestaña Monedas.'
          }
        />
      )}

      {puedeCrear && !consulta.isPending && cuentas.length === 0 && (
        <Vacio
          titulo={entidad ? `${entidad.legal_name} no tiene cuentas` : 'Todavía no hay cuentas'}
          explicacion="Las cuentas son donde se registran los cobros y los pagos. Sin ellas no hay saldo que mostrar."
          siguiente="Crea la primera con el formulario de abajo."
        />
      )}

      {cuentas.length > 0 && (
        <Lista>
          {cuentas.map((c) => (
            <Fila
              key={c.id}
              principal={
                <>
                  <span className="font-medium">{c.name}</span>
                  <Etiqueta>{c.currency_code}</Etiqueta>
                  <Etiqueta>{nombreTipoCuenta(c.kind)}</Etiqueta>
                  {!c.is_active && <Etiqueta tono="atencion">Archivada</Etiqueta>}
                </>
              }
              secundario={
                <>
                  {nombreEntidad(c.legal_entity_id)}
                  {c.bank_name ? ` · ${c.bank_name}` : ''}
                  {c.account_ref_masked ? ` · ····${c.account_ref_masked}` : ''}
                </>
              }
              extremo={
                <Boton
                  variante="sutil"
                  disabled={alternar.isPending}
                  onClick={() => alternar.mutate({ id: c.id, activa: c.is_active })}
                >
                  {c.is_active ? 'Archivar' : 'Reactivar'}
                </Boton>
              }
            />
          ))}
        </Lista>
      )}

      {alternar.error && <Aviso tipo="error">{mensajeDeError(alternar.error)}</Aviso>}

      {puedeCrear && (
        <Alta titulo="Nueva cuenta" exito={exito} onSubmit={() => crear.mutate()}>
          <Campo
            etiqueta="Nombre de la cuenta"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            maxLength={120}
            ayuda="Como la llamas tú: «BCP Soles», «Mercury», «Caja chica»."
          />

          <Selector
            etiqueta="Entidad propietaria"
            value={entidadId}
            onChange={(e) => setEntidadId(e.target.value)}
            required
            ayuda="El saldo de esta cuenta entra solo en el libro de esta entidad."
          >
            <option value="">Elige una entidad</option>
            {activas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.legal_name}
              </option>
            ))}
          </Selector>

          <Selector
            etiqueta="Moneda"
            value={moneda}
            onChange={(e) => setMoneda(e.target.value)}
            required
            ayuda="No se puede cambiar después: los movimientos ya registrados dependen de ella."
          >
            <option value="">Elige una moneda</option>
            {disponibles.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Selector>

          <Selector
            etiqueta="Tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as Enums<'account_kind'>)}
          >
            {Constants.public.Enums.account_kind.map((k) => (
              <option key={k} value={k}>
                {nombreTipoCuenta(k)}
              </option>
            ))}
          </Selector>

          <Campo
            etiqueta="Banco (opcional)"
            value={banco}
            onChange={(e) => setBanco(e.target.value)}
            maxLength={120}
          />

          <Campo
            etiqueta="Últimos dígitos (opcional)"
            value={ultimos}
            onChange={(e) => setUltimos(e.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            maxLength={4}
            ayuda="Solo para reconocer la cuenta de un vistazo. No escribas el número completo: no se guarda y no hace falta."
          />

          {crear.error && <Aviso tipo="error">{mensajeDeError(crear.error)}</Aviso>}

          <Boton
            type="submit"
            variante="primario"
            disabled={crear.isPending || !nombre.trim() || !entidadId || !moneda}
          >
            {crear.isPending ? 'Creando…' : 'Crear cuenta'}
          </Boton>
        </Alta>
      )}
    </Seccion>
  );
}
