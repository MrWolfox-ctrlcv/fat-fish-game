import { fileURLToPath } from 'node:url';
import { createGameServer } from './backend/app.mjs';
const dbPath = process.env.GAME_DB || fileURLToPath(new URL('./data/game.sqlite', import.meta.url));
const { server, store } = await createGameServer({ dbPath });
server.listen(Number(process.env.PORT || 4180), '127.0.0.1', () => console.log('Fat fish service ready on loopback.'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
