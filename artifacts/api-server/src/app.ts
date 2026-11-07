import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";

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
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(clerkMiddleware((req) => ({
  publishableKey: publishableKeyFromHost(getClerkProxyHost(req) ?? "", process.env.CLERK_PUBLISHABLE_KEY),
})));
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err && typeof err === "object" && "name" in err && err.name === "ZodError") {
    res.status(400).json({ error: "Request does not match the required schema.", details: "Check the field names, lengths, origins, and step identifiers." }); return;
  }
  if (err && typeof err === "object" && "status" in err && (err.status === 413 || err.status === 400)) {
    res.status(err.status).json({ error: err.status === 413 ? "Request body exceeds 64 KB." : "Invalid JSON request." }); return;
  }
  if (err && typeof err === "object" && "status" in err && err.status === 409) {
    res.status(409).json({ error: err instanceof Error ? err.message : "The recording cannot conclude yet." }); return;
  }
  req.log.error({ err }, "Request failed");
  res.status(500).json({ error: "Unable to persist or retrieve recording. Try again.", recorderFailure: true });
});

export default app;
