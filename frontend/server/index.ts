import express from "express";
import { resolve } from "node:path";
import { createGateway, readConfig } from "./gateway.ts";
const app = express();
app.use(createGateway(readConfig()));
app.use(express.static(resolve("dist"), { maxAge: "1h" }));
app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
app.listen(Number(process.env.PORT ?? 5173), "0.0.0.0", () =>
  console.log(
    "FLAGWA frontend server is running; private configuration is not printed.",
  ),
);
