/** Formatação compartilhada de export de conversas (Canal e número pessoal)
 *  para o Segundo Cérebro: mesmo `.md`/`.json` e mesmo caminho `/conversas/...`. */

/** Slug seguro p/ caminho: sem acento, minúsculo, não-alfanumérico → hífen. */
export function slugify(s: string | null | undefined): string {
  return (
    (s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'sem'
  );
}

export interface ExportParticipante {
  nome: string;
  papel: string;
  setor: string | null;
}

export interface ExportInput {
  id: string;
  canal: 'canal-oficial' | 'numero-pessoal';
  contatoNome: string | null;
  contatoNumero: string;
  municipio: string | null;
  assunto: string | null;
  setor: string | null;
  statusLabel: string;
  dataDay: string; // AAAA-MM-DD
  participantes: ExportParticipante[];
  contexto: string;
  resolucao: string;
  eventos: Array<{ ts: string; tipo: string; descricao: string }>;
  mensagensTotal: number;
}

export interface ExportFiles {
  basePath: string; // conversas/{municipio}/{ano}/{data}_{assunto}_{idcurto} (sem extensão)
  md: string;
  json: Record<string, unknown>;
}

/** Monta o `.md`, o objeto `.json` e o caminho-base a partir da entrada normalizada. */
export function buildExportFiles(input: ExportInput): ExportFiles {
  const ano = input.dataDay.slice(0, 4);
  const basePath = `conversas/${slugify(input.municipio ?? 'sem-municipio')}/${ano}/${input.dataDay}_${slugify(
    input.assunto ?? 'sem-assunto',
  )}_${input.id.slice(0, 8)}`;

  const exportadoEm = new Date().toISOString();
  const contatoNome = input.contatoNome || input.contatoNumero;

  const json: Record<string, unknown> = {
    id: input.id,
    data: input.dataDay,
    municipio: input.municipio ?? null,
    assunto: input.assunto ?? null,
    setor: input.setor,
    status: input.statusLabel,
    canal: input.canal,
    contato: { nome: input.contatoNome ?? null, numero: input.contatoNumero },
    participantes: input.participantes,
    contexto: input.contexto,
    resolucao: input.resolucao,
    eventos: input.eventos,
    tags: [] as string[],
    mensagens_total: input.mensagensTotal,
    exportado_em: exportadoEm,
  };

  const md = [
    '---',
    `id: ${input.id}`,
    `data: ${input.dataDay}`,
    `municipio: ${input.municipio ?? ''}`,
    `assunto: ${input.assunto ?? ''}`,
    `setor: ${input.setor ?? ''}`,
    `status: ${input.statusLabel}`,
    `canal: ${input.canal}`,
    `contato: ${contatoNome} (${input.contatoNumero})`,
    `participantes: [${input.participantes.map((p) => p.nome).join(', ')}]`,
    `mensagens_total: ${input.mensagensTotal}`,
    `exportado_em: ${exportadoEm}`,
    '---',
    '',
    `# Atendimento — ${input.assunto ?? 'Sem assunto'}${input.municipio ? ` · ${input.municipio}` : ''}`,
    '',
    '## Contexto',
    input.contexto,
    '',
    '## Andamento',
    ...(input.eventos.length
      ? input.eventos.map((e) => `- ${e.descricao}`)
      : ['- (sem eventos registrados)']),
    '',
    '## Resolução',
    input.resolucao,
    '',
  ].join('\n');

  return { basePath, md, json };
}
