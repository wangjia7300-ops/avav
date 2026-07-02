const { app, BrowserWindow, shell } = require("electron");
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const path = require("path");

const dev = process.env.NODE_ENV === "development";
const hostname = "127.0.0.1";
const port = parseInt(process.env.PORT || "3891", 10);

let mainWindow = null;

if (dev) {
  // In dev mode, assume Next.js dev server is already running at port 3000
  const devPort = parseInt(process.env.PORT || "3000", 10);
  app.whenReady().then(async () => {
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 700,
      title: "AIVIS — AI 电商视觉策划助手",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 16 },
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "preload.cjs"),
      },
      show: false,
    });

    mainWindow.once("ready-to-show", () => mainWindow.show());
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });

    await mainWindow.loadURL(`http://${hostname}:${devPort}`);
  });
} else {
  // Production: start Next.js server, THEN create window
  let serverReady = false;

  const nextApp = next({
    dev: false,
    hostname,
    port,
    dir: path.join(__dirname, ".."),
  });

  nextApp.prepare().then(() => {
    const handle = nextApp.getRequestHandler();
    const server = createServer((req, res) => {
      handle(req, res, parse(req.url, true));
    });

    server.listen(port, hostname, () => {
      serverReady = true;
      console.log(`AIVIS server running on http://${hostname}:${port}`);
    });
  });

  app.whenReady().then(async () => {
    // Wait up to 30s for the server to be ready
    const start = Date.now();
    while (!serverReady && Date.now() - start < 30000) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!serverReady) {
      console.error("Server failed to start within 30s");
      app.quit();
      return;
    }

    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 700,
      title: "AIVIS — AI 电商视觉策划助手",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 16 },
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "preload.cjs"),
      },
      show: false,
    });

    mainWindow.once("ready-to-show", () => mainWindow.show());
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });

    await mainWindow.loadURL(`http://${hostname}:${port}`);
  });
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    app.quit();
    app.relaunch();
  }
});
