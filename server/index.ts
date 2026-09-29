import { createApplication } from "./app.ts";
const server = createApplication();
const port = Number(process.env.PORT ?? 3001);
server.http.listen(port, process.env.HOST ?? "0.0.0.0", () =>
  console.log(`Darwin斗地主 server listening on ${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await server.close();
    process.exit(0);
  });
