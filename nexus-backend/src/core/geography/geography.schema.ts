/**
 * Drizzle schema for the `places` geography tree (spec 03 §1).
 * PostGIS + ltree types are declared via customType so Drizzle emits the right
 * SQL types and gives us typed query building. The DDL itself lives in the
 * hand-written migration src/db/migrations/0001_places.sql (PostGIS specifics).
 */
import { customType, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const ltree = customType<{ data: string }>({ dataType: () => 'ltree' });
const geographyPoint = customType<{ data: string }>({ dataType: () => 'geography(Point,4326)' });
const geographyMultiPolygon = customType<{ data: string }>({ dataType: () => 'geography(MultiPolygon,4326)' });

export const placeLevel = pgEnum('place_level', [
  'country',
  'region',
  'district',
  'constituency',
  'community',
]);

export const places = pgTable('places', {
  id: uuid('id').primaryKey().defaultRandom(),
  parentId: uuid('parent_id'),
  level: placeLevel('level').notNull(),
  code: text('code'),
  name: text('name').notNull(),
  category: text('category'),
  population: integer('population'),
  centroid: geographyPoint('centroid'),
  boundary: geographyMultiPolygon('boundary'),
  path: ltree('path').notNull(),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Place = typeof places.$inferSelect;
export type NewPlace = typeof places.$inferInsert;
