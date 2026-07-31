"use strict";

const http = require("node:http");

const debugPort = Number(process.argv[2] || 47839);
const extensionId = String(process.argv[3] || "");
const runnerUrl = `chrome-extension://${extensionId}/mediaRunner.html`;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(5000, () => request.destroy(new Error("Chrome debug timeout.")));
    request.on("error", reject);
  });
}

async function findRunner() {
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const targets = await getJson(`http://127.0.0.1:${debugPort}/json/list`);
    const target = targets.find(
      (item) => item.type === "page" && item.url === runnerUrl,
    );
    if (target?.webSocketDebuggerUrl) return target;
    await delay(400);
  }
  throw new Error(`Runner tab not found: ${runnerUrl}`);
}

async function main() {
  if (!extensionId) throw new Error("Extension ID is required.");
  const target = await findRunner();
  const socket = new WebSocket(target.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("CDP connect timeout.")), 10000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("CDP connection failed."));
    }, { once: true });
  });

  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timeout);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result || {});
  });

  function send(method, params = {}, timeoutMs = 60000) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression, awaitPromise = true) {
    const response = await send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ||
          response.exceptionDetails.text ||
          "Runtime evaluation failed.",
      );
    }
    return response.result?.value;
  }

  await send("Runtime.enable");

  const raw = await evaluate(`(async () => {
    const result = {
      href: location.href,
      version: chrome.runtime.getManifest().version,
      readyState: document.readyState,
      hasRunQueue: typeof runQueue === "function",
      hasRequestJson: typeof requestJson === "function",
      hasTabs: Boolean(chrome.tabs),
      hasScripting: Boolean(chrome.scripting),
      scripts: Array.from(document.scripts).map((script) => script.src),
      state: document.getElementById("runner-state")?.textContent || "",
      current: document.getElementById("runner-current")?.textContent || "",
      log: document.getElementById("runner-log")?.textContent || ""
    };

    try {
      const response = await fetch("http://127.0.0.1:47833/health", { cache: "no-store" });
      result.bridge = {
        reachable: true,
        ok: response.ok,
        status: response.status,
        body: await response.text()
      };
    } catch (error) {
      result.bridge = {
        reachable: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }

    if (result.hasRunQueue && result.bridge.reachable && result.bridge.ok) {
      void runQueue();
      result.forced = true;
    } else {
      result.forced = false;
    }

    return JSON.stringify(result);
  })()`);

  socket.close();
  const result = JSON.parse(raw);
  console.log(JSON.stringify(result, null, 2));

  if (!result.hasRunQueue) process.exitCode = 3;
  else if (!result.bridge?.reachable || !result.bridge?.ok) process.exitCode = 4;
  else if (!result.forced) process.exitCode = 5;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
