const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("svnx", {
  startupReady: () => ipcRenderer.send("svnx:startup-ready"),
  bootstrap: () => ipcRenderer.invoke("svnx:bootstrap"),
  run: (request) => ipcRenderer.invoke("svnx:run", request),
  cancel: (id) => ipcRenderer.invoke("svnx:cancel", id),
  copyText: (text) => ipcRenderer.invoke("svnx:copy-text", text),
  openWorkspace: () => ipcRenderer.invoke("svnx:open"),
  chooseCheckout: () => ipcRenderer.invoke("svnx:checkout-directory"),
  removeWorkspace: (id) => ipcRenderer.invoke("svnx:remove", id),
  settings: (patch) => ipcRenderer.invoke("svnx:settings", patch),
  chooseEngine: () => ipcRenderer.invoke("svnx:engine"),
  chooseExternalTool: () => ipcRenderer.invoke("svnx:external-tool"),
  externalDiff: (params) => ipcRenderer.invoke("svnx:external-diff", params),
  reveal: (params) => ipcRenderer.invoke("svnx:reveal", params),
  onEvent: (callback) => {
    const listener = (_, event) => callback(event);
    ipcRenderer.on("svnx:event", listener);
    return () => ipcRenderer.removeListener("svnx:event", listener);
  },
});
