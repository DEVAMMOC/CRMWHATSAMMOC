// Normalização de número espelhando a função SQL `normalize_phone` do banco
// (migração contacts_canonical_entity). Mantém o agrupamento client-side
// coerente com a chave canônica `contacts.phone_key`.
//
// Regra: só dígitos; remove o código de país `55` quando o total tem ≥ 12 dígitos.
export function phoneKey(raw: string | null | undefined): string {
  const d = (raw ?? '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) return d.slice(2);
  return d;
}
