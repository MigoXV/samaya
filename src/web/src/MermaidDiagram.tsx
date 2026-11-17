import { useEffect, useId, useState } from "react";

export function MermaidDiagram({ source }: { source: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [result, setResult] = useState<{
    source: string;
    url?: string;
    error?: boolean;
  }>();
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
          suppressErrorRendering: true,
          htmlLabels: false,
        });
        const { svg } = await mermaid.render(`diagram${id}`, source);
        if (active)
          setResult({
            source,
            url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
          });
      } catch {
        if (active) setResult({ source, error: true });
      }
    })();
    return () => {
      active = false;
    };
  }, [id, source]);
  const current = result?.source === source ? result : undefined;
  return (
    <div className="mermaid-preview">
      {current?.url ? (
        <img
          src={current.url}
          alt="Mermaid 图表"
          style={{ maxWidth: "100%", height: "auto" }}
        />
      ) : (
        <p role="status">
          {current?.error ? "图表暂时无法渲染，请查看源码。" : "正在生成图表…"}
        </p>
      )}
    </div>
  );
}
