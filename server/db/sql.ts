import { sql, type Column } from 'drizzle-orm';

/**
 * Reference an outer-query column from inside a correlated subquery in a select field.
 * Drizzle renders a column placed directly in a single-table select field as a bare `"id"`,
 * which the subquery would resolve against its own table. Nesting it in its own `sql`
 * fragment keeps it table-qualified (`"series"."id"`).
 */
export const outer = (column: Column) => sql`${column}`;
