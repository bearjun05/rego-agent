export * from './schema.js';
export { getDb, closeDb, schema, type Db } from './client.js';

// 자주 쓰는 drizzle 연산자 재노출 (scripts/ 등 drizzle-orm 직접 의존이 없는 곳에서 사용)
export { eq, inArray, and, or, sql, desc, asc, gte, lte } from 'drizzle-orm';
