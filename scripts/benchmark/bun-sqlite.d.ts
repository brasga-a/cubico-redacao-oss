/** Minimal typing for the Bun built-in used by the offline benchmark report. */
declare module 'bun:sqlite' {
  export class Database {
    constructor(filename: string, options?: { readonly?: boolean })
    query(sql: string): { all: () => unknown[] }
  }
}
