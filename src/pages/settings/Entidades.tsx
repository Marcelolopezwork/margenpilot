import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useMonedasHabilitadas } from '../../app/consultas';
import { useOrg, useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { nombrePais } from '../../lib/format';
import { requireSupabase } from '../../lib/supabase';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Vacio } from '../../components/ui';
import { Alta, Fila, Lista, Seccion } from './piezas';
import { useRecargar } from './recargar';

export default function Entidades() {
  const { organizacion } = useOrgElegida();
  const { entidades, cargando } = useOrg();
  const monedas = useMonedasHabilitadas(organizacion.id);
  const recargar = useRecargar(['entidades']);

  const [nombre, setNombre] = useState('');
  const [pais, setPais] = useState('PE');
  const [moneda, setMoneda] = useState('');
  const [ruc, setRuc] = useState('');

  const crear = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase()
        .from('legal_entities')
        .insert({
          organization_id: organizacion.id,
          legal_name: nombre.trim(),
          country: pais.trim().toUpperCase(),
          default_currency_code: moneda,
          tax_id: ruc.trim() || null,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      setNombre('');
      setRuc('');
      recargar();
    },
  });

  const alternar = useMutation({
    mutationFn: async ({ id, activa }: { id: string; activa: boolean }) => {
      const { error } = await requireSupabase()
        .from('legal_entities')
        .update({ is_active: !activa })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: recargar,
  });

  const disponibles = monedas.data ?? [];

  return (
    <Seccion
      titulo="Entidades legales"
      regla="Cada entidad es un libro contable aparte: su moneda, sus impuestos, sus cuentas y su rentabilidad. Ninguna cifra mezcla dos entidades, y eso no es una preferencia de informe sino una regla que la base de datos hace cumplir. La razón social es el nombre que se imprime en las cotizaciones."
    >
      {cargando && <Cargando que="las entidades" />}

      {!cargando && entidades.length === 0 && (
        <Vacio
          titulo="Todavía no hay ninguna entidad"
          explicacion="Una entidad legal es la empresa que factura: con su país, su moneda habitual y su régimen de impuestos."
          siguiente="Crea la primera con el formulario de abajo. Si operas en dos países, serán dos entidades, no una con dos monedas."
        />
      )}

      {entidades.length > 0 && (
        <Lista>
          {entidades.map((e) => (
            <Fila
              key={e.id}
              principal={
                <>
                  <span className="font-medium">{e.legal_name}</span>
                  <Etiqueta>{e.default_currency_code}</Etiqueta>
                  {!e.is_active && <Etiqueta tono="atencion">Archivada</Etiqueta>}
                </>
              }
              secundario={
                <>
                  {nombrePais(e.country)}
                  {e.tax_id ? ` · ${e.tax_id}` : ''}
                </>
              }
              extremo={
                <Boton
                  variante="sutil"
                  disabled={alternar.isPending}
                  onClick={() => alternar.mutate({ id: e.id, activa: e.is_active })}
                >
                  {e.is_active ? 'Archivar' : 'Reactivar'}
                </Boton>
              }
            />
          ))}
        </Lista>
      )}

      {alternar.error && <Aviso tipo="error">{mensajeDeError(alternar.error)}</Aviso>}

      <Alta titulo="Nueva entidad legal" onSubmit={() => crear.mutate()}>
        <Campo
          etiqueta="Razón social"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          maxLength={200}
          ayuda="Tal como la imprime el registro. Es el nombre que sale en la cotización."
        />

        <Campo
          etiqueta="País"
          value={pais}
          onChange={(e) => setPais(e.target.value.toUpperCase())}
          required
          maxLength={2}
          minLength={2}
          ayuda="Código de dos letras: PE, US, CL…"
        />

        <Selector
          etiqueta="Moneda habitual"
          value={moneda}
          onChange={(e) => setMoneda(e.target.value)}
          required
          ayuda="Solo aparecen las monedas habilitadas en la organización. Si falta una, habilítala en Monedas."
        >
          <option value="">Elige una moneda</option>
          {disponibles.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Selector>

        <Campo
          etiqueta="Identificación fiscal (opcional)"
          value={ruc}
          onChange={(e) => setRuc(e.target.value)}
          maxLength={32}
          ayuda="RUC en Perú, EIN en Estados Unidos. Se imprime en el documento."
        />

        {disponibles.length === 0 && !monedas.isPending && (
          <Aviso tipo="atencion">
            No hay ninguna moneda habilitada en esta organización, así que no se puede crear una
            entidad todavía. Habilita al menos una en Monedas.
          </Aviso>
        )}

        {crear.error && <Aviso tipo="error">{mensajeDeError(crear.error)}</Aviso>}

        <Boton
          type="submit"
          variante="primario"
          disabled={crear.isPending || !nombre.trim() || !moneda || pais.trim().length !== 2}
        >
          {crear.isPending ? 'Creando…' : 'Crear entidad'}
        </Boton>
      </Alta>
    </Seccion>
  );
}
