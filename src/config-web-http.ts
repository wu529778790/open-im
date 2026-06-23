import type { IncomingMessage, ServerResponse } from "node:http";
import { mergeCors } from "./config-web-cors.js";

const MAX_REQUEST_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

export function readJson<T>(request: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    request.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        reject(new Error("Request body too large (max 1 MB)"));
        request.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve((raw ? JSON.parse(raw) : {}) as T);
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

export function jsonResponse(response: ServerResponse, statusCode: number, body: unknown, request: IncomingMessage): void {
  response.writeHead(statusCode, mergeCors(request, { "content-type": "application/json; charset=utf-8" }));
  response.end(JSON.stringify(body));
}
