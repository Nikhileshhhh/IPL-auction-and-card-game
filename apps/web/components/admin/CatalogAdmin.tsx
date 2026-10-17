'use client';

/* eslint-disable @next/next/no-img-element -- admin previews of private, already re-encoded WebP thumbnails */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Badge, Button, Dialog, StatusMessage, Surface, TextField } from '@stumps/ui';
import {
  MAX_IMAGE_BYTES,
  ROLE_LABELS,
  type AdminPlayerRow,
  type DataVersionSummary,
  type PlayerRole,
  type PublicCardDTO,
} from '@stumps/contracts';
import { api } from '@/lib/api-client';
import { PremiumCricketCard } from '@/components/cards/PremiumCricketCard';
import { CardDetailDialog } from '@/components/cards/CardDetail';

const adminMedia = (url: string) => url.replace(/^\/api\/media\//, '/api/admin-media/');
const asAdminCard = (card: PublicCardDTO): PublicCardDTO => ({
  ...card,
  players: card.players.map((p) => ({ ...p, portraitUrl: adminMedia(p.portraitUrl) })),
});

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

const MISSING_LABELS: Record<AdminPlayerRow['missing'][number], string> = {
  photo: 'IPL jersey photo',
  ipl_kit: 'jersey confirmation',
  country: 'country',
  batting_style: 'batting style',
  bowling_style: 'bowling style',
};

/** Upload a licensed photo of the player in IPL franchise jersey, with rights evidence. */
function UploadDialog({
  player,
  onClose,
  onDone,
}: {
  player: AdminPlayerRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [basis, setBasis] = useState<'licensed' | 'free-license'>('licensed');
  const [licence, setLicence] = useState('');
  const [author, setAuthor] = useState('');
  const [attribution, setAttribution] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [jersey, setJersey] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooBig = file !== null && file.size > MAX_IMAGE_BYTES;
  const sourceOk =
    sourceUrl.trim() === '' ? basis === 'licensed' : sourceUrl.startsWith('https://');
  const valid =
    file !== null &&
    !tooBig &&
    jersey &&
    licence.trim() &&
    author.trim() &&
    attribution.trim() &&
    sourceOk;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!player || !file || !valid) return;
    setPending(true);
    setError(null);
    const res = await api('/admin/catalog/media', {
      method: 'POST',
      body: {
        playerId: player.playerId,
        imageBase64: await readAsBase64(file),
        iplKit: true,
        rights: {
          basis,
          licence: licence.trim(),
          author: author.trim(),
          attribution: attribution.trim(),
          ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
        },
      },
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    onDone();
  }

  return (
    <Dialog
      open={player !== null}
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={`IPL jersey photo for ${player?.name ?? ''}`}
      description="PNG, JPEG or WebP up to 2 MiB showing the player in their IPL franchise jersey. It is cropped to the card frame, re-encoded and stripped of metadata. Your licence details are recorded with the photo."
    >
      <form
        onSubmit={(e) => void submit(e)}
        className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1"
      >
        <label className="flex flex-col gap-2 text-sm font-medium">
          Image file
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
        </label>
        {tooBig ? <p className="text-sm text-bad">This file is larger than 2 MiB.</p> : null}
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={jersey}
            onChange={(e) => setJersey(e.target.checked)}
            className="mt-1"
          />
          <span>The photo shows this player wearing their IPL franchise jersey.</span>
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Rights basis</legend>
          {(
            [
              ['licensed', 'Licensed to us (agreement / permission on file)'],
              ['free-license', 'Free licence (e.g. CC BY-SA)'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="basis"
                checked={basis === value}
                onChange={() => setBasis(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <TextField
          label="Licence"
          value={licence}
          onChange={(e) => setLicence(e.target.value)}
          hint="For example: Image licence agreement #2026-01"
        />
        <TextField
          label="Licence holder / photographer"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
        />
        <TextField
          label="Credit line shown to players"
          value={attribution}
          onChange={(e) => setAttribution(e.target.value)}
        />
        <TextField
          label={basis === 'licensed' ? 'Source page (https, optional)' : 'Source page (https)'}
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
        />
        {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" pending={pending} pendingLabel="Uploading…" disabled={!valid}>
            Upload photo
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Country, batting and bowling style for one player (every card must show them). */
function FactsDialog({
  player,
  onClose,
  onDone,
}: {
  player: AdminPlayerRow | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [country, setCountry] = useState(player?.country ?? '');
  const [batting, setBatting] = useState<'right_hand' | 'left_hand' | ''>(
    player?.battingStyle ?? '',
  );
  const [bowling, setBowling] = useState(player?.bowlingStyle ?? '');
  const [error, setError] = useState<string | null>(null);
  const countryOk = /^[A-Za-z]{2}$/.test(country.trim());
  const bowlingOk = !player?.bowls || bowling.trim().length > 0;
  const valid = countryOk && batting !== '' && bowlingOk;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!player || !valid) return;
    const res = await api(`/admin/catalog/players/${player.playerId}`, {
      method: 'PATCH',
      body: {
        countryCode: country.trim().toUpperCase(),
        battingStyle: batting,
        bowlingStyle: bowling.trim() ? bowling.trim() : null,
      },
    });
    if (!res.ok) setError(res.error.message);
    else onDone(`${player.name}: details saved.`);
  }

  return (
    <Dialog
      open={player !== null}
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={`Details for ${player?.name ?? ''}`}
      description="Every published card shows these values."
    >
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
        <TextField
          label="Country (2-letter code)"
          value={country}
          maxLength={2}
          onChange={(e) => setCountry(e.target.value)}
          hint="For example IN, AU, GB, ZA, NZ, AF, LK, JM"
        />
        <label className="flex flex-col gap-2 text-sm font-medium">
          Batting style
          <select
            value={batting}
            onChange={(e) => setBatting(e.target.value as 'right_hand' | 'left_hand' | '')}
            className="min-h-11 rounded border border-control bg-midnight px-2"
          >
            <option value="">Choose…</option>
            <option value="right_hand">Right-hand bat</option>
            <option value="left_hand">Left-hand bat</option>
          </select>
        </label>
        <TextField
          label={player?.bowls ? 'Bowling style' : 'Bowling style (leave empty: does not bowl)'}
          value={bowling}
          maxLength={40}
          onChange={(e) => setBowling(e.target.value)}
          hint="For example: Right-arm fast-medium, Slow left-arm orthodox"
        />
        {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid}>
            Save details
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Bulk facts + licensed photo URLs via the player sheet (CSV). */
function PlayerSheet({
  version,
  onChanged,
}: {
  version: DataVersionSummary;
  onChanged: () => void;
}) {
  const [report, setReport] = useState<{
    updatedFacts: number;
    photos: number;
    issues: { line: number; playerKey: string; message: string }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function download() {
    const res = await api<{ csv: string }>(`/admin/catalog/versions/${version.id}/player-sheet`);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    const url = URL.createObjectURL(new Blob([res.data.csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `player-sheet-${version.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setPending(true);
    setError(null);
    const res = await api<NonNullable<typeof report>>('/admin/catalog/player-sheet', {
      method: 'POST',
      body: { csv: await file.text() },
    });
    setPending(false);
    if (res.ok) {
      setReport(res.data);
      onChanged();
    } else setError(res.error.message);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <p className="text-sm text-ink-2">
        Fill in full names, country, batting and bowling style, and a photo URL of each player in
        IPL jersey from your licensed source (its host must be listed in PHOTO_IMPORT_HOSTS on the
        server; local photo files can be imported with <code>pnpm data:profiles</code>).
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="touch" variant="secondary" onClick={() => void download()}>
          Download player sheet
        </Button>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border border-control px-4 text-sm font-semibold">
          {pending ? 'Importing…' : 'Upload filled sheet'}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
        </label>
      </div>
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      {report ? (
        <StatusMessage tone={report.issues.length ? 'warning' : 'success'}>
          {report.updatedFacts} players updated, {report.photos} photos imported.
          {report.issues.length ? (
            <ul className="mt-2 list-disc pl-5">
              {report.issues.slice(0, 20).map((i) => (
                <li key={`${i.line}-${i.playerKey}`}>
                  Line {i.line} ({i.playerKey}): {i.message}
                </li>
              ))}
            </ul>
          ) : null}
        </StatusMessage>
      ) : null}
    </div>
  );
}

function PlayersTab({
  version,
  onChanged,
}: {
  version: DataVersionSummary;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [facts, setFacts] = useState<AdminPlayerRow | null>(null);
  const [data, setData] = useState<{ items: AdminPlayerRow[]; total: number } | null>(null);
  const [upload, setUpload] = useState<AdminPlayerRow | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({
      ...(query ? { q: query } : {}),
      incomplete: String(missingOnly),
    });
    const res = await api<{ items: AdminPlayerRow[]; total: number }>(
      `/admin/catalog/versions/${version.id}/players?${qs.toString()}`,
    );
    if (res.ok) setData(res.data);
  }, [version.id, query, missingOnly]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  async function setRole(player: AdminPlayerRow, role: PlayerRole) {
    const res = await api(`/admin/catalog/players/${player.playerId}`, {
      method: 'PATCH',
      body: { role },
    });
    setMessage(
      res.ok
        ? `${player.name}: role saved. Rebuild a draft to apply it to ratings.`
        : res.error.message,
    );
    void load();
  }

  async function review(player: AdminPlayerRow, decision: 'approved' | 'rejected') {
    if (!player.portrait) return;
    const res = await api(`/admin/catalog/media/${player.portrait.assetId}/review`, {
      method: 'POST',
      body: { decision },
    });
    setMessage(
      res.ok
        ? `${player.name}: photo ${decision === 'approved' ? 'approved' : 'revoked'}.`
        : res.error.message,
    );
    void load();
    onChanged();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <TextField
          label="Search players"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-64"
        />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={missingOnly}
            onChange={(e) => setMissingOnly(e.target.checked)}
          />
          Only players with something missing
        </label>
        <span className="text-sm text-ink-3">{data ? `${data.total} players` : 'Loading…'}</span>
      </div>
      {message ? <StatusMessage tone="info">{message}</StatusMessage> : null}
      {/* `relative` keeps absolutely positioned sr-only labels inside the scroller. */}
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs tracking-wide text-ink-3 uppercase">
            <tr>
              <th className="py-2">Photo</th>
              <th>Player</th>
              <th>Role</th>
              <th>Bat / Bowl</th>
              <th>Photo status</th>
              <th className="sr-only">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((p) => (
              <tr key={p.playerId} className="border-t border-line">
                <td className="py-2">
                  {p.portrait ? (
                    <img
                      src={`/api/admin-media/${p.portrait.assetId}/320`}
                      alt={`Photo of ${p.name}`}
                      width={48}
                      height={64}
                      className="h-16 w-12 rounded object-cover"
                    />
                  ) : (
                    <span className="inline-grid h-16 w-12 place-items-center rounded bg-overlay text-[10px] text-ink-3">
                      None
                    </span>
                  )}
                </td>
                <td>
                  <span className="font-medium">{p.name}</span>
                  <span className="block text-xs text-ink-3">
                    {p.team ?? 'No team'} · {p.country ?? '??'} ·{' '}
                    {p.battingStyle === 'left_hand'
                      ? 'LHB'
                      : p.battingStyle === 'right_hand'
                        ? 'RHB'
                        : '?'}
                    {p.bowlingStyle ? ` · ${p.bowlingStyle}` : p.bowls ? ' · bowling style ?' : ''}
                  </span>
                  {p.missing.length ? (
                    <span className="mt-1 block text-xs text-warn">
                      Missing: {p.missing.map((m) => MISSING_LABELS[m]).join(', ')}
                    </span>
                  ) : (
                    <span className="mt-1 block text-xs text-ok">Ready for publishing</span>
                  )}
                </td>
                <td>
                  <select
                    aria-label={`Role of ${p.name}`}
                    value={p.role}
                    onChange={(e) => void setRole(p, e.target.value as PlayerRole)}
                    className="min-h-11 rounded border border-control bg-midnight px-2"
                  >
                    {Object.entries(ROLE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {p.roleReviewed ? <span className="ml-2 text-xs text-ok">reviewed</span> : null}
                </td>
                <td className="tabular-nums">
                  {p.ratings ? `${p.ratings.batting} / ${p.ratings.bowling}` : '—'}
                </td>
                <td>
                  {p.portrait ? (
                    <span>
                      <Badge tone={p.portrait.status === 'approved' ? 'card' : 'warning'}>
                        {p.portrait.status}
                      </Badge>
                      <span
                        className="block max-w-[220px] truncate text-xs text-ink-3"
                        title={p.portrait.credit ?? ''}
                      >
                        {p.portrait.basis === 'original-generated'
                          ? 'Original demo illustration'
                          : (p.portrait.credit ?? '')}
                      </span>
                    </span>
                  ) : (
                    <Badge tone="warning">missing</Badge>
                  )}
                </td>
                <td className="text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="touch" variant="secondary" onClick={() => setFacts(p)}>
                      Details
                    </Button>
                    <Button size="touch" variant="secondary" onClick={() => setUpload(p)}>
                      Upload
                    </Button>
                    {p.portrait?.status === 'approved' ? (
                      <Button
                        size="touch"
                        variant="danger"
                        onClick={() => void review(p, 'rejected')}
                      >
                        Revoke
                      </Button>
                    ) : p.portrait ? (
                      <Button size="touch" onClick={() => void review(p, 'approved')}>
                        Approve
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {facts ? (
        <FactsDialog
          key={facts.playerId}
          player={facts}
          onClose={() => setFacts(null)}
          onDone={(m) => {
            setFacts(null);
            setMessage(m);
            void load();
            onChanged();
          }}
        />
      ) : null}
      <UploadDialog
        player={upload}
        onClose={() => setUpload(null)}
        onDone={() => {
          setUpload(null);
          setMessage('Photo uploaded and attached to draft versions.');
          void load();
          onChanged();
        }}
      />
    </div>
  );
}

const adminDetailPath = (id: string) => `/admin/catalog/cards/${id}`;

function CardsTab({ version }: { version: DataVersionSummary }) {
  const [cards, setCards] = useState<PublicCardDTO[] | null>(null);
  const [selected, setSelected] = useState<PublicCardDTO | null>(null);
  useEffect(() => {
    void api<{ items: PublicCardDTO[] }>(`/admin/catalog/versions/${version.id}/cards`).then(
      (res) => {
        if (res.ok) setCards(res.data.items.map(asAdminCard));
      },
    );
  }, [version.id]);
  return (
    <>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] justify-items-center gap-5">
        {(cards ?? []).map((card) => (
          <li key={card.definitionId}>
            <button
              type="button"
              onClick={() => setSelected(card)}
              aria-label={`Preview ${card.players.map((p) => p.name).join(' & ')}`}
            >
              <PremiumCricketCard card={card} size="compact" />
            </button>
          </li>
        ))}
      </ul>
      <CardDetailDialog
        card={selected}
        onClose={() => setSelected(null)}
        detailPath={adminDetailPath}
      />
    </>
  );
}

/** S34 data editor: imports, coverage, corrections, photos, publish/archive. */
export function CatalogAdmin() {
  const [versions, setVersions] = useState<DataVersionSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'players' | 'cards'>('players');
  const [job, setJob] = useState<{
    id: string;
    status: string;
    summary: Record<string, unknown>;
  } | null>(null);
  const [message, setMessage] = useState<{
    tone: 'info' | 'error' | 'success';
    text: string;
  } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [prune, setPrune] = useState(true);
  const [pending, setPending] = useState(false);

  const load = useCallback(
    () =>
      api<{ items: DataVersionSummary[] }>('/admin/catalog/versions').then((res) => {
        if (!res.ok) return;
        setVersions(res.data.items);
        setSelectedId((prev) => prev ?? res.data.items[0]?.id ?? null);
      }),
    [],
  );
  useEffect(() => {
    let live = true;
    void api<{ items: DataVersionSummary[] }>('/admin/catalog/versions').then((res) => {
      if (!live || !res.ok) return;
      setVersions(res.data.items);
      setSelectedId((prev) => prev ?? res.data.items[0]?.id ?? null);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const t = setInterval(() => {
      void api<{ status: string; summary: Record<string, unknown>; dataVersionId: string | null }>(
        `/admin/catalog/imports/${job.id}`,
      ).then((res) => {
        if (!res.ok) return;
        setJob({ id: job.id, status: res.data.status, summary: res.data.summary });
        if (res.data.status !== 'running') {
          void load();
          if (res.data.dataVersionId) setSelectedId(res.data.dataVersionId);
        }
      });
    }, 1500);
    return () => clearInterval(t);
  }, [job, load]);

  async function startImport(kind: 'demo' | 'cricsheet') {
    const label = `${kind === 'demo' ? 'Demo pack' : 'IPL pack'} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    const res = await api<{ importId: string }>('/admin/catalog/imports', {
      method: 'POST',
      body: { kind, label },
    });
    if (res.ok) setJob({ id: res.data.importId, status: 'running', summary: {} });
    else setMessage({ tone: 'error', text: res.error.message });
  }

  const selected = versions?.find((v) => v.id === selectedId) ?? null;
  const missing = selected ? selected.players - selected.withPortrait : 0;

  async function act(path: string, body: unknown, done: string) {
    setPending(true);
    const res = await api(path, { method: 'POST', body });
    setPending(false);
    if (res.ok) setMessage({ tone: 'success', text: done });
    else {
      const problems = (
        res.error.details as { problems?: { message: string; count: number }[] } | undefined
      )?.problems;
      setMessage({
        tone: 'error',
        text: problems
          ? problems.map((p) => `${p.message} (${p.count})`).join(' ')
          : res.error.message,
      });
    }
    void load();
  }

  return (
    <div className="flex flex-col gap-6">
      <Surface aria-labelledby="imports-heading">
        <h2 id="imports-heading" className="text-lg font-semibold">
          Import data
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          Real IPL statistics come from Cricsheet&apos;s ball-by-ball archive (run{' '}
          <code>pnpm data:fetch</code> on the server first). Photos come from free-licence sources (
          <code>pnpm data:photos</code>) or uploads below.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            onClick={() => void startImport('cricsheet')}
            disabled={job?.status === 'running'}
          >
            Import IPL data (Cricsheet)
          </Button>
          <Button
            variant="secondary"
            onClick={() => void startImport('demo')}
            disabled={job?.status === 'running'}
          >
            Import demo pack
          </Button>
        </div>
        {job ? (
          <p role="status" className="mt-3 text-sm text-ink-2">
            Import {job.status}
            {job.summary.error ? `: ${String(job.summary.error)}` : ''}
            {job.summary.players
              ? ` · ${String(job.summary.players)} players, ${String(job.summary.cards)} cards`
              : ''}
          </p>
        ) : null}
      </Surface>

      {message ? <StatusMessage tone={message.tone}>{message.text}</StatusMessage> : null}

      <Surface aria-labelledby="versions-heading">
        <h2 id="versions-heading" className="text-lg font-semibold">
          Data versions
        </h2>
        <ul className="mt-3 flex flex-col gap-2">
          {(versions ?? []).map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => setSelectedId(v.id)}
                aria-pressed={v.id === selectedId}
                className={`flex min-h-11 w-full flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-left ${v.id === selectedId ? 'border-card' : 'border-line'}`}
              >
                <span className="font-medium">{v.label}</span>
                <Badge
                  tone={
                    v.status === 'published' ? 'card' : v.status === 'draft' ? 'warning' : 'neutral'
                  }
                >
                  {v.status}
                </Badge>
                <span className="text-xs text-ink-3">
                  {v.kind} · {v.players} players · {v.cards} cards · {v.withPortrait} with photos
                </span>
              </button>
            </li>
          ))}
          {versions?.length === 0 ? (
            <li className="text-sm text-ink-3">No data versions yet.</li>
          ) : null}
        </ul>
      </Surface>

      {selected ? (
        <Surface aria-labelledby="version-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="version-heading" className="text-lg font-semibold">
                {selected.label}
              </h2>
              <p className="text-sm text-ink-2">{selected.windowLabel}</p>
              <p className="text-sm text-ink-3">
                Photo coverage: {selected.withPortrait} of {selected.players} players
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selected.status === 'draft' ? (
                <>
                  <Button onClick={() => setPublishOpen(true)}>Publish…</Button>
                  <Button
                    variant="danger"
                    pending={pending}
                    onClick={() =>
                      void act(
                        `/admin/catalog/versions/${selected.id}/discard`,
                        {},
                        'Draft discarded.',
                      )
                    }
                  >
                    Discard draft
                  </Button>
                </>
              ) : selected.status === 'published' ? (
                <Button
                  variant="secondary"
                  pending={pending}
                  onClick={() =>
                    void act(
                      `/admin/catalog/versions/${selected.id}/archive`,
                      {},
                      'Version archived.',
                    )
                  }
                >
                  Archive
                </Button>
              ) : null}
            </div>
          </div>
          {selected.validation && !selected.validation.ok ? (
            <ul className="mt-3 list-disc pl-5 text-sm text-warn">
              {selected.validation.problems.map((p) => (
                <li key={p.code}>
                  {p.message} ({p.count})
                </li>
              ))}
            </ul>
          ) : null}
          <div role="tablist" aria-label="Version views" className="mt-6 flex flex-wrap gap-2">
            {(['players', 'cards'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`min-h-11 rounded-lg px-4 ${tab === t ? 'bg-overlay font-semibold' : 'text-ink-2'}`}
              >
                {t === 'players' ? 'Players & photos' : 'Card preview'}
              </button>
            ))}
          </div>
          <div className="mt-4">
            {tab === 'players' ? (
              <div className="flex flex-col gap-4">
                {selected.status === 'draft' ? (
                  <PlayerSheet version={selected} onChanged={() => void load()} />
                ) : null}
                <PlayersTab version={selected} onChanged={() => void load()} />
              </div>
            ) : (
              <CardsTab version={selected} />
            )}
          </div>
        </Surface>
      ) : null}

      <Dialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title="Publish this version?"
        description="Published data is immutable: corrections need a new version. Rooms that start afterwards use it."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button
              pending={pending}
              onClick={() => {
                setPublishOpen(false);
                if (selected)
                  void act(
                    `/admin/catalog/${selected.id}/publish`,
                    { prune },
                    'Version published.',
                  );
              }}
            >
              Publish
            </Button>
          </>
        }
      >
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={prune}
            onChange={(e) => setPrune(e.target.checked)}
            className="mt-1"
          />
          <span>
            Leave out cards that are not complete yet (no IPL jersey photo, or a missing country,
            batting or bowling style)
            {missing > 0 ? ` — ${missing} players currently have no photo` : ''}. Without this,
            publishing is blocked until every card is complete.
          </span>
        </label>
      </Dialog>
    </div>
  );
}
