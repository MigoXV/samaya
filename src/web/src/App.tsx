import { useEffect, useState } from "react";
import { api, setCsrf } from "./api";
import { ThemeSelect } from "./ThemeSelect";
import { MonitorWorkbench } from "./MonitorWorkbench";

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [token, setToken] = useState("");
  const [loginError, setLoginError] = useState("");
  useEffect(() => {
    const expired = () => setAuthenticated(false);
    window.addEventListener("samaya:unauthorized", expired);
    void api<{ authenticated: boolean; csrf?: string }>("/auth")
      .then((r) => {
        setCsrf(r.csrf || "");
        setAuthenticated(r.authenticated);
      })
      .catch((e) => setLoginError(String(e)));
    return () => window.removeEventListener("samaya:unauthorized", expired);
  }, []);
  if (authenticated === null)
    return (
      <main className="login">
        <h1>Samaya</h1>
        <p>{loginError || "正在连接工作台…"}</p>
        {loginError && (
          <button onClick={() => location.reload()}>重新连接</button>
        )}
      </main>
    );
  if (!authenticated)
    return (
      <main className="login">
        <div className="eyebrow">Samaya / 服务器工作台</div>
        <h1>进入工作空间</h1>
        <p className="muted">使用服务器配置的访问口令登录。</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const r = await api<{ csrf: string }>("/login", {
                method: "POST",
                body: JSON.stringify({ token }),
              });
              setCsrf(r.csrf);
              setToken("");
              setAuthenticated(true);
            } catch (err) {
              setLoginError(String(err));
            }
          }}
        >
          <label>
            访问口令
            <input
              type="password"
              autoComplete="current-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
          </label>
          {loginError && <p role="alert">{loginError}</p>}
          <button className="primary">登录</button>
        </form>
        <ThemeSelect />
      </main>
    );
  return <MonitorWorkbench logout={() => setAuthenticated(false)} />;
}
