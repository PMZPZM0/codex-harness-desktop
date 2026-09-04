import fs from "fs";

let p = fs.readFileSync("electron/preload.ts", "utf8").replace(/\r\n/g, "\n");
let d = fs.readFileSync("src/vite-env.d.ts", "utf8").replace(/\r\n/g, "\n");

// preload：加 RPA + tasks API（插在 memory 相关旁）
const anchor = `  saveMemory: (input: unknown) => ipcRenderer.invoke("memory:save", input),`;
const i = p.indexOf(anchor);
if (i < 0) { console.error("preload anchor missing"); process.exit(1); }
const add = `  saveMemory: (input: unknown) => ipcRenderer.invoke("memory:save", input),
  listRpaRecipes: () => ipcRenderer.invoke("rpa:list"),
  saveRpaRecipe: (input: unknown) => ipcRenderer.invoke("rpa:save", input),
  deleteRpaRecipe: (id: string) => ipcRenderer.invoke("rpa:delete", id),
  recordRpaRun: (input: { id: string; ok: boolean; error?: string }) => ipcRenderer.invoke("rpa:record", input),
  listTasks: () => ipcRenderer.invoke("tasks:list"),
  addTask: (input: { text: string; priority?: string }) => ipcRenderer.invoke("tasks:add", input),
  updateTask: (input: { id: string; patch: unknown }) => ipcRenderer.invoke("tasks:update", input),
  deleteTask: (id: string) => ipcRenderer.invoke("tasks:delete", id),`;
p = p.slice(0, i) + add + p.slice(i + anchor.length);
fs.writeFileSync("electron/preload.ts", p.replace(/\n/g, "\r\n"), "utf8");
console.log("preload RPA API added");

// d.ts：类型声明
const danchor = `    saveMemory(input: unknown): Promise<unknown>;`;
const di = d.indexOf(danchor);
if (di < 0) { console.error("dts anchor missing"); process.exit(1); }
const dadd = `    saveMemory(input: unknown): Promise<unknown>;
    listRpaRecipes(): Promise<any[]>;
    saveRpaRecipe(input: unknown): Promise<any>;
    deleteRpaRecipe(id: string): Promise<void>;
    recordRpaRun(input: { id: string; ok: boolean; error?: string }): Promise<void>;
    listTasks(): Promise<any[]>;
    addTask(input: { text: string; priority?: string }): Promise<any>;
    updateTask(input: { id: string; patch: unknown }): Promise<any>;
    deleteTask(id: string): Promise<void>;`;
d = d.slice(0, di) + dadd + d.slice(di + danchor.length);
fs.writeFileSync("src/vite-env.d.ts", d.replace(/\n/g, "\r\n"), "utf8");
console.log("d.ts RPA types added");
