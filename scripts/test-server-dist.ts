import { TavilyKeyPool } from "../dist/keyPool.js";
import { handleAdminApi } from "../dist/adminApi.js";
import http from "node:http";

const pool = new TavilyKeyPool([]);
const server = http.createServer((req, res) => {
  handleAdminApi(req, res, pool)
    .then((h) => {
      if (!h) {
        res.writeHead(404);
        res.end();
      }
    })
    .catch(() => {
      res.writeHead(500);
      res.end();
    });
});
server.listen(8094, async () => {
  console.log("ready");
  // 鐢ㄥ甫 x-forwarded-for 鐨勮姹傛祴璇曪紙绋冲畾 IP锛?  for (let i = 1; i <= 6; i++) {
    const r = await fetch("http://127.0.0.1:8094/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
      body: JSON.stringify({ password: "wrong" }),
    });
    console.log(`绗?${i} 娆? HTTP ${r.status}`);
  }
  const ok = await fetch("http://127.0.0.1:8094/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify({ password: "admin123" }),
  });
  console.log(`閿佸畾鍚? HTTP ${ok.status}`);
  const store = (globalThis as Record<string, unknown>).__tavilyLoginFailures;
  console.log("闄愭祦 store:", store ? JSON.stringify(Array.from((store as Map<string, unknown>).entries())) : "null");
  server.close();
  process.exit(0);
});


