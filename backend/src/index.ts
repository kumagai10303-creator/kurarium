import { startServer } from './server.js';

const server = await startServer();

let stopping = false;
async function shutdown(code = 0): Promise<void> {
  if (stopping) return;
  stopping = true;
  await server.stop();
  process.exit(code);
}

process.on('SIGINT', () => {
  void shutdown(0);
});
process.on('SIGTERM', () => {
  void shutdown(0);
});
process.on('uncaughtException', (e) => {
  console.error(e);
  void shutdown(1);
});
process.on('unhandledRejection', (e) => {
  console.error(e);
});
