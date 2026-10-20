import { createApp } from "./app";

const port = Number(process.env.PORT ?? 4100);
const app = createApp();

const server = app.listen(port, () => {
  const issuer = process.env.HEARTH_AUTH_ISSUER ?? `http://localhost:${port}`;
  console.log(`hearth auth-server listening on port ${port} (issuer ${issuer})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
