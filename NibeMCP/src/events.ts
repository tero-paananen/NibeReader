import {randomUUID} from 'node:crypto';
import {type Config} from './config.js';
import {openHistory, parseDate} from './history.js';
import {period, type Period} from './analysis.js';

export function recordEvent(
  c: Config,
  request: {timestamp: string; category: string; note: string}
) {
  const ts = parseDate(request.timestamp),
    category = request.category.trim(),
    note = request.note.trim();
  if (!category || category.length > 80 || !note || note.length > 4000)
    throw new Error(
      'category must contain 1–80 characters and note 1–4000 characters.'
    );
  const event = {
    id: randomUUID(),
    timestamp: new Date(ts).toISOString(),
    category,
    note,
    created_at: new Date().toISOString(),
  };
  const db = openHistory(c, true)!;
  try {
    db.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?)').run(
      event.id,
      ts,
      category,
      note,
      Date.parse(event.created_at)
    );
    return {
      event,
      storage: 'local_only',
      message:
        'Recorded a user-reported note. No heat-pump setting was changed or verified.',
    };
  } finally {
    db.close();
  }
}
export function listEvents(c: Config, request: Period & {category?: string}) {
  const {start, end} = period(request);
  const category = request.category?.trim();
  if (category !== undefined && (!category || category.length > 80))
    throw new Error('category must contain 1–80 characters.');
  const db = openHistory(c);
  try {
    const exists = db
      ?.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='events'"
      )
      .get();
    const rows = exists
      ? db!
          .prepare(
            'SELECT * FROM events WHERE ts>=? AND ts<? AND (? IS NULL OR category=?) ORDER BY ts,id LIMIT 1001'
          )
          .all(start, end, category ?? null, category ?? null)
      : [];
    return {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      events: rows.slice(0, 1000).map(r => ({
        id: r.id,
        timestamp: new Date(Number(r.ts)).toISOString(),
        category: r.category,
        note: r.note,
        created_at: new Date(Number(r.created_at)).toISOString(),
      })),
      truncated: rows.length > 1000,
      note: 'User-reported local notes, not verified changes. Narrow the time range if truncated. Events are retained independently of reading retention.',
    };
  } finally {
    db?.close();
  }
}
