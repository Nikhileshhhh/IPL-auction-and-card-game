import type { QueryResultRow, QueryResult } from 'pg';
import { AppError } from '../http/app-error';

/** The single row a statement must return (e.g. INSERT … RETURNING); fails closed otherwise. */
export function one<T extends QueryResultRow>(result: QueryResult<T>): T {
  const row = result.rows[0];
  if (!row) throw new AppError('INTERNAL', 'Expected a row.');
  return row;
}
