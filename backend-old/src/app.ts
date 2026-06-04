import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Serve the Telegram Mini App at /app
const publicDir = path.join(__dirname, "public");
app.use("/app", express.static(publicDir));
app.get("/app/{*splat}", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// Serve the Admin Dashboard at /admin
app.use("/admin", express.static(publicDir));
app.get("/admin", (_req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});
app.get("/admin/{*splat}", (_req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});

export default app;
