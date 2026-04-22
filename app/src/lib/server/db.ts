import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

export const sql = postgres(url, {
	max: 10,
	idle_timeout: 30,
	connect_timeout: 10,
	prepare: true,
	transform: { undefined: null }
});

export type Sql = typeof sql;
