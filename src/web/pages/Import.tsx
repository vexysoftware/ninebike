// Importação de contatos do sistema anterior: CSV → mapeamento de colunas → prévia → envio em lotes.
import { useMemo, useState } from 'react';
import { api, describeError } from '../api';
import { PageHead, useCommand } from '../components/Shell';
import { Empty, Field, Status, formatInstant, useLoad } from '../components/ui';

type Target = 'name' | 'mobile_phone' | 'cpf' | 'email' | 'birthday' | 'notes' | '';
const TARGETS: Array<[Target, string]> = [['', '— ignorar —'], ['name', 'Nome'], ['mobile_phone', 'Celular / WhatsApp'], ['cpf', 'CPF'],
  ['email', 'E-mail'], ['birthday', 'Nascimento'], ['notes', 'Observação']];
const GUESS: Array<[RegExp, Target]> = [[/^(nome|name|cliente|raz[aã]o)/i, 'name'], [/(celular|whats|telefone|fone|phone|contato)/i, 'mobile_phone'],
  [/cpf/i, 'cpf'], [/e-?mail/i, 'email'], [/(nasc|anivers|birth)/i, 'birthday'], [/(obs|nota|coment)/i, 'notes']];
const REASON: Record<string, string> = { required: 'obrigatório', invalid_br_mobile: 'celular inválido (precisa DDD + 9 dígitos)', invalid_cpf: 'CPF inválido',
  invalid_email: 'e-mail inválido', invalid_date: 'data inválida', future_date: 'data no futuro', already_exists: 'já cadastrado (celular ou CPF)' };
const FIELD: Record<string, string> = { name: 'Nome', mobile_phone: 'Celular', cpf: 'CPF', email: 'E-mail', birthday: 'Nascimento' };

/** CSV com ; , ou tab, aspas e quebras de linha dentro de aspas. */
function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

async function readText(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  const utf = new TextDecoder('utf-8').decode(buf);
  // Planilhas exportadas pelo Excel em PT-BR costumam vir em Windows-1252.
  return (utf.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf).replace(/^﻿/, '');
}

type Result = { created: number; skipped: Array<{ line: number; reason: string }>; invalid: Array<{ line: number; field: string; reason: string }> };

export function ImportPage() {
  const users = useLoad(() => api.get<{ users: Array<{ id: string; name: string; active: boolean }> }>('/api/v1/admin/users'), []);
  const batches = useLoad(() => api.get<Array<{ id: string; file_name: string; owner_name: string; created: number; skipped: number; invalid: number; created_at: string }>>('/api/v1/imports/contacts'), []);
  const [file, setFile] = useState<{ name: string; header: string[]; rows: string[][] } | null>(null);
  const [map, setMap] = useState<Target[]>([]);
  const [owner, setOwner] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cmd = useCommand();

  async function onFile(f: File | undefined) {
    setResult(null); setErr(null);
    if (!f) return;
    const all = parseCsv(await readText(f));
    if (all.length < 2) { setErr('O arquivo precisa ter uma linha de cabeçalho e ao menos um contato.'); return; }
    const header = all[0].map((h) => h.trim());
    setFile({ name: f.name, header, rows: all.slice(1) });
    const used = new Set<Target>();
    setMap(header.map((h) => { const g = GUESS.find(([re, t]) => re.test(h) && !used.has(t))?.[1] ?? ''; if (g) used.add(g); return g; }));
  }

  const ready = map.includes('name') && map.includes('mobile_phone');
  const preview = useMemo(() => file?.rows.slice(0, 5) ?? [], [file]);

  async function run() {
    if (!file) return;
    const batch_id = crypto.randomUUID();
    const rows = file.rows.map((r, i) => {
      const o: Record<string, unknown> = { line: i + 2 };
      map.forEach((t, j) => { if (t && r[j]?.trim()) o[t] = t === 'notes' && o.notes ? `${o.notes} · ${r[j].trim()}` : r[j].trim(); });
      return o;
    });
    const total: Result = { created: 0, skipped: [], invalid: [] };
    setProgress({ done: 0, total: rows.length });
    for (let i = 0; i < rows.length; i += 400) {
      const r = await cmd.run<Result>('POST', '/api/v1/imports/contacts', { batch_id, file_name: file.name, owner_id: owner || null, rows: rows.slice(i, i + 400) });
      if (!r) { setErr(`Parou na linha ${i + 2}. ${cmd.error ? describeError(cmd.error) : ''} O que já foi importado foi mantido; reenviar o arquivo não duplica.`); break; }
      total.created += r.created; total.skipped.push(...r.skipped); total.invalid.push(...r.invalid);
      setProgress({ done: Math.min(i + 400, rows.length), total: rows.length });
    }
    setResult(total); batches.reload();
  }

  function downloadProblems() {
    if (!result || !file) return;
    const lines = [['linha', 'motivo', ...file.header].join(';')];
    const byLine = new Map<number, string>();
    result.invalid.forEach((x) => byLine.set(x.line, `${FIELD[x.field] ?? x.field}: ${REASON[x.reason] ?? x.reason}`));
    result.skipped.forEach((x) => byLine.set(x.line, REASON[x.reason] ?? x.reason));
    [...byLine.entries()].sort((a, b) => a[0] - b[0]).forEach(([ln, why]) =>
      lines.push([ln, why, ...(file.rows[ln - 2] ?? [])].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = `problemas-${file.name}`; a.click();
  }

  return (
    <>
      <PageHead title="Importar contatos" />
      <section className="card">
        <div className="card-head"><h2>1. Arquivo</h2></div>
        <p className="subtle" style={{ marginBottom: 12 }}>Exporte os clientes do sistema antigo em <strong>CSV</strong> (no Excel: Salvar como → CSV). Precisa de nome e celular; CPF, e-mail, nascimento e observação são opcionais.
          Celular ou CPF já cadastrado é pulado. Contatos importados são clientes da loja e não contam como trazidos pela IA.</p>
        <input type="file" accept=".csv,text/csv,.txt" onChange={(e) => void onFile(e.target.files?.[0])} aria-label="Arquivo CSV" />
        {err && <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}>{err}</div>}
      </section>

      {file && (
        <section className="card">
          <div className="card-head"><h2>2. Colunas</h2><span className="subtle">{file.rows.length} linha(s) em {file.name}</span></div>
          <div className="table-wrap" style={{ border: 0 }}><table className="table">
            <thead><tr>{file.header.map((h, j) => (
              <th key={j}><div>{h || `Coluna ${j + 1}`}</div>
                <select className="input" style={{ marginTop: 6 }} aria-label={`Campo da coluna ${h}`} value={map[j]} onChange={(e) => { const m = [...map]; m[j] = e.target.value as Target; setMap(m); }}>
                  {TARGETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></th>))}</tr></thead>
            <tbody>{preview.map((r, i) => <tr key={i}>{file.header.map((_, j) => <td key={j} className={map[j] ? '' : 'subtle'}>{r[j]}</td>)}</tr>)}</tbody>
          </table></div>
          {!ready && <div className="alert" style={{ marginTop: 12 }}>Escolha qual coluna é <strong>Nome</strong> e qual é <strong>Celular / WhatsApp</strong>.</div>}
          <div className="form-grid" style={{ marginTop: 16 }}>
            <Field label="Vendedor responsável pelos contatos">{(p) => (
              <select {...p} className="input" value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">Eu (proprietário)</option>
                {users.data?.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>)}</Field>
            <div className="form-actions" style={{ alignSelf: 'end' }}>
              <button className="btn btn-primary" disabled={!ready || cmd.busy} onClick={() => void run()}>
                {cmd.busy && progress ? `Importando ${progress.done}/${progress.total}…` : `Importar ${file.rows.length} contato(s)`}</button></div>
          </div>
        </section>)}

      {result && (
        <section className="card">
          <div className="card-head"><h2>3. Resultado</h2></div>
          <div className="stats">
            <div className="stat"><div className="k">Importados</div><div className="v">{result.created}</div></div>
            <div className="stat"><div className="k">Já existiam</div><div className="v">{result.skipped.length}</div></div>
            <div className="stat"><div className="k">Com problema</div><div className="v">{result.invalid.length}</div></div>
          </div>
          {(result.invalid.length > 0 || result.skipped.length > 0) && (
            <>
              <ul className="timeline">{result.invalid.slice(0, 15).map((x) => (
                <li key={x.line}><span className="dot" /><div>Linha {x.line}: {FIELD[x.field] ?? x.field} — {REASON[x.reason] ?? x.reason}</div></li>))}</ul>
              <button className="btn" onClick={downloadProblems}>Baixar planilha com os problemas</button>
            </>)}
        </section>)}

      <section className="card">
        <div className="card-head"><h2>Importações anteriores</h2></div>
        {!batches.data?.length ? <Empty title="Nenhuma importação ainda." /> : (
          <div className="table-wrap" style={{ border: 0 }}><table className="table">
            <thead><tr><th>Quando</th><th>Arquivo</th><th>Responsável</th><th className="num">Importados</th><th className="num">Já existiam</th><th className="num">Problemas</th></tr></thead>
            <tbody>{batches.data.map((b) => (
              <tr key={b.id}><td>{formatInstant(b.created_at)}</td><td>{b.file_name}</td><td>{b.owner_name}</td>
                <td className="num"><Status tone="ok">{b.created}</Status></td><td className="num">{b.skipped}</td><td className="num">{b.invalid}</td></tr>))}</tbody>
          </table></div>)}
      </section>
    </>
  );
}
