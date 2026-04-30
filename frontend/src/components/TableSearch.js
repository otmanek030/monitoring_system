/**
 * TableSearch — reusable real-time filter input for any table.
 *
 * Pure presentational component. The parent owns the `value` and `onChange`,
 * does the filtering, and passes `total` / `shown` for the row-count badge.
 *
 *   <TableSearch
 *     value={q}
 *     onChange={setQ}
 *     total={items.length}
 *     shown={filtered.length}
 *     placeholder="Search alarms…"
 *   />
 *
 * Includes:
 *   - 🔍 input with placeholder
 *   - ✕ clear button (only when value is non-empty)
 *   - "Showing X of Y" / "All Y" / "No matches" badge
 *
 * Pair with the `useTableSearch` hook below for the most common case
 * (filter an array by string fields).
 */
import { useMemo } from 'react';

export default function TableSearch({
  value,
  onChange,
  total = 0,
  shown,
  placeholder = 'Search…',
  width = 240,
}) {
  const isFiltered = !!value && value.length > 0;
  const showCount = isFiltered ? `${shown ?? 0} of ${total}` : `All ${total}`;
  const empty = isFiltered && shown === 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ position: 'relative', width }}>
        <span aria-hidden="true" style={{
          position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)',
          fontSize: 12, color: 'var(--td)', pointerEvents: 'none',
        }}>🔍</span>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label="Search"
          style={{
            width: '100%',
            padding: '5px 28px 5px 28px',
            fontSize: 12,
            border: '1px solid var(--border)',
            borderRadius: 6,
            background: '#fff',
            color: 'var(--tx)',
            outline: 'none',
          }}
        />
        {isFiltered && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear search"
            title="Clear"
            style={{
              position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
              border: 'none', background: 'transparent', cursor: 'pointer',
              fontSize: 14, color: 'var(--td)', padding: 0, lineHeight: 1,
            }}
          >
            ✕
          </button>
        )}
      </div>
      <span style={{
        fontSize: 11, fontWeight: 500,
        color: empty ? 'var(--red)' : 'var(--tm)',
        background: empty ? 'rgba(214,69,69,.08)' : 'var(--g-softer)',
        border: `1px solid ${empty ? 'rgba(214,69,69,.3)' : 'var(--border)'}`,
        borderRadius: 4,
        padding: '2px 8px',
        whiteSpace: 'nowrap',
      }}>
        {empty ? 'No matches' : `Showing ${showCount}`}
      </span>
    </div>
  );
}

/**
 * Hook: filter a list of objects by a free-text query against a list of fields.
 * Case-insensitive, substring match, useMemo-cached.
 *
 *   const filtered = useTableSearch(items, query, ['tag', 'name', 'status']);
 *
 * `fields` may include nested paths via dot notation (e.g. 'equipment.tag').
 */
export function useTableSearch(items, query, fields) {
  return useMemo(() => {
    if (!query || !query.trim()) return items;
    const q = query.toLowerCase();
    const fns = fields.map(path => {
      const parts = path.split('.');
      return obj => {
        let v = obj;
        for (const p of parts) v = v?.[p];
        return v;
      };
    });
    return items.filter(item => fns.some(fn => {
      const v = fn(item);
      if (v == null) return false;
      return String(v).toLowerCase().includes(q);
    }));
  }, [items, query, fields]);
}

/**
 * Render a "no results" tbody row that matches the calling table's column
 * count. Use inside `<tbody>` when the filtered list is empty:
 *
 *   {filtered.length === 0
 *     ? <NoResultsRow colSpan={6} query={query} />
 *     : filtered.map(...)}
 */
export function NoResultsRow({ colSpan = 1, query, message }) {
  return (
    <tr>
      <td colSpan={colSpan} style={{ textAlign: 'center', padding: 28, color: 'var(--tm)', fontSize: 13 }}>
        {message || (
          query
            ? <>No rows match <code style={{ background: 'var(--g-softer)', padding: '1px 6px', borderRadius: 3 }}>{query}</code></>
            : 'No rows to display.'
        )}
      </td>
    </tr>
  );
}
