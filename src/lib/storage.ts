/**
 * localStorage que no tira la app.
 *
 * En ventana privada, con las cookies bloqueadas o con el almacenamiento
 * lleno, cada acceso puede lanzar. Aquí solo guardamos preferencias de vista
 * —tema, organización elegida, entidad elegida—, nunca datos: si se pierden,
 * la app vuelve a su valor por defecto y no pasa nada.
 */

const PREFIJO = 'margen.';

export function leer(clave: string): string | null {
  try {
    return window.localStorage.getItem(PREFIJO + clave);
  } catch {
    return null;
  }
}

export function escribir(clave: string, valor: string): void {
  try {
    window.localStorage.setItem(PREFIJO + clave, valor);
  } catch {
    // Sin sitio o sin permiso: la preferencia no se recuerda y es aceptable.
  }
}

export function borrar(clave: string): void {
  try {
    window.localStorage.removeItem(PREFIJO + clave);
  } catch {
    // Igual que arriba.
  }
}
