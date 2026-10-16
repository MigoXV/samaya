import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type {
  ClipboardEvent,
  Dispatch,
  ReactNode,
  SetStateAction,
} from "react";
import {
  IMAGE_TYPES,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_BYTES,
  readImage,
} from "./composer-images";
import type { InputImage } from "./composer-images";
import { api } from "./api";
import { fileScope, queueFiles, useFileDraft } from "./composer-files";
import { FileAttachments } from "./FileAttachments";
import { Modal } from "./components";
import { hasReference, inputTrigger, slashInput } from "./composer-model";
import type {
  InputCatalog,
  InputReference,
  SlashCommand,
} from "./composer-model";
import "./composer.css";

type Candidate = {
  key: string;
  title: string;
  description: string;
  source: string;
  reference?: InputReference;
  command?: SlashCommand;
  prompt?: { name: string; text: string };
  enabled: boolean;
};
export function ComposerInput({
  value,
  onChange,
  references,
  onReferences,
  images,
  onImages,
  cwd,
  threadId,
  active = false,
  disabled = false,
  onSubmit,
  onCommand,
  onStop,
  label = "补充当前任务",
  placeholder,
  modelSelector,
  modeControl,
  onToggleMode,
  submitDisabled = false,
}: {
  value: string;
  onChange: (s: string) => void;
  references: InputReference[];
  onReferences: (r: InputReference[]) => void;
  images: InputImage[];
  onImages: Dispatch<SetStateAction<InputImage[]>>;
  cwd: string;
  threadId?: string;
  active?: boolean;
  disabled?: boolean;
  onSubmit: () => void;
  onCommand: (c: SlashCommand, args: string) => void;
  onStop?: () => void;
  label?: string;
  placeholder?: string;
  modelSelector?: ReactNode;
  modeControl?: ReactNode;
  onToggleMode?: () => void;
  submitDisabled?: boolean;
}) {
  const [catalog, setCatalog] = useState<InputCatalog | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [caret, setCaret] = useState(value.length),
    [dismissed, setDismissed] = useState(false),
    [manual, setManual] = useState<"skills" | "apps" | "commands" | null>(null),
    [selected, setSelected] = useState(0),
    [literal, setLiteral] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null),
    menu = useRef<HTMLDivElement>(null),
    imagePicker = useRef<HTMLInputElement>(null),
    id = useId();
  const identity = threadId || cwd;
  const attachmentScope = fileScope(cwd, threadId);
  const [files] = useFileDraft(attachmentScope);
  const filesPending = files.some((file) => file.status !== "ready");
  const [dragging, setDragging] = useState(false);
  function addSelected(selected: File[]) {
    if (disabled || !selected.length) return;
    const pictures = selected.filter((file) => IMAGE_TYPES.includes(file.type));
    const documents = selected.filter(
      (file) => !IMAGE_TYPES.includes(file.type),
    );
    try {
      if (documents.length)
        queueFiles(attachmentScope, documents, cwd, threadId);
      setImageError("");
      if (pictures.length) void addImages(pictures);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "文件上传失败");
    }
  }

  const [previewImage, setPreviewImage] = useState<InputImage | null>(null);
  const [imageState, setImageState] = useState({
    identity,
    reading: false,
    error: "",
  });
  const readingImages = imageState.identity === identity && imageState.reading;
  const imageError = imageState.identity === identity ? imageState.error : "";
  const setReadingImages = (reading: boolean) =>
    setImageState((state) => ({
      identity,
      reading,
      error: state.identity === identity ? state.error : "",
    }));
  const setImageError = (error: string) =>
    setImageState((state) => ({
      identity,
      reading: state.identity === identity && state.reading,
      error,
    }));
  const pendingImages = useRef({ count: 0, bytes: 0 });
  const imageGeneration = useRef(0);
  useEffect(() => {
    imageGeneration.current++;
    pendingImages.current = { count: 0, bytes: 0 };
    const scope = imageGeneration;
    return () => {
      scope.current++;
    };
  }, [identity]);
  async function pasteImages(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (disabled) return;
    const clipboardFiles = Array.from(event.clipboardData.files);
    if (clipboardFiles.some(file => !file.type.startsWith("image/"))) {
      event.preventDefault();
      addSelected(clipboardFiles);
      return;
    }
    const items = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);
    const files = items.length
      ? items
      : Array.from(event.clipboardData.files).filter((file) =>
          file.type.startsWith("image/"),
        );
    if (!files.length) {
      // Some screenshot tools expose no File in the paste event. Read the OS
      // clipboard during this user gesture, without interfering with text paste.
      if (event.clipboardData.getData("text/plain")) return;
      event.preventDefault();
      if (!navigator.clipboard?.read) {
        setImageError("浏览器未提供截图，请重新复制截图或使用“上传文件”。");
        return;
      }
      const generation = imageGeneration.current;
      setReadingImages(true);
      setImageError("");
      try {
        const clipboard = await navigator.clipboard.read();
        const images: File[] = [];
        for (const item of clipboard) {
          const type = item.types.find((type) => IMAGE_TYPES.includes(type));
          if (type)
            images.push(
              new File(
                [await item.getType(type)],
                "粘贴图片." + type.split("/")[1],
                { type },
              ),
            );
        }
        if (generation !== imageGeneration.current) return;
        if (!images.length) {
          setImageError("剪贴板中未找到图片，请重新复制截图或使用“上传文件”。");
          return;
        }
        await addImages(images);
      } catch {
        if (generation === imageGeneration.current)
          setImageError(
            "无法读取截图，请允许浏览器读取剪贴板后重试，或使用“上传文件”。",
          );
      } finally {
        if (generation === imageGeneration.current)
          setReadingImages(pendingImages.current.count > 0);
      }
      return;
    }
    event.preventDefault();
    await addImages(files);
  }
  async function addImages(files: File[]) {
    if (disabled || !files.length) return;
    setDismissed(true);
    setManual(null);
    const bytes = files.reduce((sum, file) => sum + file.size, 0);
    const message = files.some((file) => !IMAGE_TYPES.includes(file.type))
      ? "支持粘贴 PNG、JPEG、WebP 或 GIF 图片。"
      : files.some((file) => !file.size || file.size > MAX_IMAGE_BYTES)
        ? "每张图片应小于等于 5 MB，且不能为空。"
        : images.length + pendingImages.current.count + files.length >
            MAX_IMAGES
          ? "每条消息最多添加 5 张图片。"
          : images.reduce((sum, image) => sum + image.size, 0) +
                pendingImages.current.bytes +
                bytes >
              MAX_TOTAL_IMAGE_BYTES
            ? "每条消息的图片总大小不能超过 10 MB。"
            : "";
    if (message) {
      setImageError(message);
      return;
    }
    const generation = imageGeneration.current;
    pendingImages.current.count += files.length;
    pendingImages.current.bytes += bytes;
    setReadingImages(true);
    setImageError("");
    try {
      const added = await Promise.all(files.map(readImage));
      if (generation === imageGeneration.current)
        onImages((current) => [...current, ...added]);
    } catch (error) {
      if (generation === imageGeneration.current) setImageError(String(error));
    } finally {
      if (generation === imageGeneration.current) {
        pendingImages.current.count -= files.length;
        pendingImages.current.bytes -= bytes;
        setReadingImages(pendingImages.current.count > 0);
      }
    }
  }
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    if (!cwd) return;
    const fetchCatalog = async (force = false) => {
      setLoading(true);
      try {
        const q = new URLSearchParams(threadId ? { threadId } : { cwd });
        if (force) q.set("refresh", "true");
        const r = await api<InputCatalog>(`/input-catalog?${q}`, {
          signal: controller.signal,
        });
        if (alive) {
          setCatalog(r);
          setError("");
        }
      } catch (e) {
        if (alive) setError(String(e));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void fetchCatalog(refresh > 0);
    const focus = () => void fetchCatalog();
    window.addEventListener("focus", focus);
    const timer = setInterval(focus, 30000);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [identity, cwd, threadId, refresh]);
  useLayoutEffect(() => {
    const el = input.current;
    const resize = () => {
      if (!el) return;
      el.style.height = "0px";
      const style = getComputedStyle(el);
      const limit =
        Number.parseFloat(style.maxHeight) ||
        Math.min(168, window.innerHeight * 0.33);
      const lineHeight = Number.parseFloat(style.lineHeight);
      el.style.height =
        Math.min(
          limit,
          Math.max(
            Number.parseFloat(style.minHeight) || lineHeight,
            el.scrollHeight,
          ),
        ) + "px";
      el.style.overflowY = el.scrollHeight > limit ? "auto" : "hidden";
    };
    resize();
    window.addEventListener("resize", resize);
    const observer = new ResizeObserver(resize);
    if (el?.parentElement) observer.observe(el.parentElement);
    return () => {
      window.removeEventListener("resize", resize);
      observer.disconnect();
    };
  }, [value]);
  useEffect(() => {
    menu.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const trigger =
    dismissed || (images.length && value.trimStart().startsWith("/"))
      ? null
      : inputTrigger(value, caret);
  const mode = manual ? (manual === "commands" ? "/" : "$") : trigger?.mode;
  const query = manual ? "" : trigger?.query.toLowerCase() || "";
  const ready = catalog?.cwd === cwd;
  const candidates: Candidate[] = [];
  if (mode && ready) {
    if (mode === "/")
      for (const c of catalog.commands || [])
        candidates.push({
          key: "command:" + c.name,
          title: "/" + c.name,
          description: c.description,
          source: "内置命令",
          command: c,
          enabled: c.enabled,
        });
    for (const r of catalog.references) {
      if (
        (manual === "skills" && r.type !== "skill") ||
        (manual === "apps" && r.type !== "mention") ||
        (mode === "/" && r.type !== "skill")
      )
        continue;
      candidates.push({
        key: r.type + ":" + r.path,
        title: (mode === "/" ? "/" : "$") + r.name,
        description: r.description || r.label,
        source:
          r.type === "mention"
            ? "应用"
            : {
                repo: "项目技能",
                user: "用户技能",
                system: "系统技能",
                admin: "管理技能",
              }[r.source] || "技能",
        reference: r,
        enabled: r.enabled,
      });
    }
    if (mode === "/")
      for (const p of catalog.prompts || [])
        candidates.push({
          key: "prompt:" + p.name,
          title: "/prompts:" + p.name,
          description: "自定义提示词 · 选择后检查正文",
          source: "提示词",
          prompt: p,
          enabled: true,
        });
  }
  const matches = candidates
    .filter(
      (c) =>
        !query || `${c.title} ${c.description}`.toLowerCase().includes(query),
    )
    .sort(
      (a, b) =>
        Number(b.title.slice(1).startsWith(query)) -
        Number(a.title.slice(1).startsWith(query)),
    )
    .slice(0, 100);
  const selectedIndex = Math.min(selected, Math.max(0, matches.length - 1));
  const stale = references.some(
    (r) =>
      r.cwd !== cwd ||
      (ready &&
        !catalog.references.some(
          (n) => n.path === r.path && n.type === r.type && n.enabled,
        )),
  );
  function change(text: string) {
    onChange(text);
    onReferences(references.filter((r) => hasReference(text, r.name)));
    setLiteral(false);
    setDismissed(false);
    setManual(null);
    setSelected(0);
  }
  function choose(c: Candidate) {
    if (c.command) {
      if (browse(c.command)) return;
      setDismissed(true);
      setManual(null);
      onCommand(c.command, slashInput(value)?.args || "");
      return;
    }
    if (!c.enabled) return;
    const start = trigger?.start ?? caret,
      end = trigger?.end ?? caret;
    const replacement = c.reference ? `$${c.reference.name} ` : c.prompt!.text;
    const next = value.slice(0, start) + replacement + value.slice(end);
    onChange(next);
    setCaret(start + replacement.length);
    if (c.reference) {
      const r = { ...c.reference, cwd };
      onReferences([...references.filter((x) => x.name !== r.name), r]);
    }
    setManual(null);
    setDismissed(true);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(
        start + replacement.length,
        start + replacement.length,
      );
    });
  }
  function browse(c: SlashCommand) {
    if (c.name !== "skills" && c.name !== "apps") return false;
    if (slashInput(value)?.name === c.name) onChange("");
    setManual(c.name);
    setSelected(0);
    setCaret(0);
    setDismissed(true);
    input.current?.focus();
    return true;
  }
  function submit() {
    if (submitDisabled || readingImages || filesPending) return;
    if (disabled || (!value.trim() && !images.length && !files.length) || stale)
      return;
    const cmd =
      !literal && !images.length && !files.length && slashInput(value);
    if (cmd) {
      const c = catalog?.commands?.find((c) => c.name === cmd.name);
      if (c) {
        if (browse(c)) return;
        onCommand(c, cmd.args);
        setDismissed(true);
        return;
      }
      const prompt = catalog?.prompts?.find(
        (p) => "prompts:" + p.name === cmd.name,
      );
      if (prompt) {
        onChange(
          prompt.text
            .replaceAll("$ARGUMENTS", cmd.args)
            .replace(
              /\$(\d+)/g,
              (_, n) => cmd.args.split(/\s+/)[Number(n) - 1] || "",
            ),
        );
        setDismissed(true);
        return;
      }
      const skills =
        catalog?.references.filter(
          (r) => r.type === "skill" && r.name === cmd.name && r.enabled,
        ) || [];
      if (skills.length === 1) {
        onChange(`$${cmd.name} ${cmd.args}`);
        onReferences([
          ...references.filter((r) => r.name !== skills[0].name),
          { ...skills[0], cwd },
        ]);
        setDismissed(true);
        return;
      }
      setError(
        skills.length > 1
          ? "存在同名技能，请从候选中选择来源。"
          : "未识别此命令；可修改命令，或明确按普通文本发送。",
      );
      setDismissed(true);
      return;
    }
    onSubmit();
    setManual(null);
    setDismissed(true);
  }
  const stopMode =
    active && !!onStop && !value.trim() && !images.length && !files.length;
  return (
    <div className="composer-shell">
      <input
        ref={imagePicker}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files || []);
          event.currentTarget.value = "";
          addSelected(files);
        }}
      />
      {previewImage && (
        <Modal
          title="图片预览"
          className="image-preview-dialog"
          close={() => setPreviewImage(null)}
        >
          <img src={previewImage.url} alt={previewImage.name} />
        </Modal>
      )}
      {readingImages && <small role="status">正在读取图片…</small>}
      {imageError && (
        <small className="composer-error" role="alert">
          {imageError}
        </small>
      )}
      {references.length > 0 && (
        <details className="composer-references">
          <summary title={references.map((r) => r.label).join("、")}>
            <span>${references[0].name}</span>
            {references.length > 1 && <span>＋{references.length - 1}</span>}
          </summary>
          <div className="reference-list">
            {references.map((r) => (
              <div key={r.type + r.path}>
                <span>
                  {r.label}
                  <small>{r.path}</small>
                </span>
                <button
                  type="button"
                  aria-label={"移除 " + r.label}
                  onClick={() => {
                    onReferences(references.filter((x) => x !== r));
                    onChange(value.replace(`$${r.name}`, ""));
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
      <div
        className={`composer-input${dragging ? " is-dragging" : ""}`}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = disabled ? "none" : "copy";
          if (!disabled) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDragging(false);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging(false);
          addSelected(Array.from(event.dataTransfer.files));
        }}
        role="combobox"
        aria-label="上下文与命令选择"
        aria-expanded={!!mode}
        aria-haspopup="listbox"
        aria-controls={mode ? id : undefined}
      >
        {dragging && (
          <small className="composer-drop-hint">松开以上传文件</small>
        )}
        <FileAttachments
          files={files}
          scope={attachmentScope}
          cwd={cwd}
          tid={threadId}
          disabled={disabled}
        />
        {!!images.length && (
          <div className="composer-images" aria-label="待发送图片">
            {images.map((image, index) => (
              <div className="composer-image" key={image.id}>
                <button
                  type="button"
                  className="composer-image-preview"
                  aria-label={`放大查看图片 ${index + 1}`}
                  onClick={() => setPreviewImage(image)}
                >
                  <img
                    src={image.url}
                    alt={`待发送图片 ${index + 1}：${image.name}`}
                  />
                </button>
                <button
                  type="button"
                  className="quiet composer-image-remove"
                  aria-label={`移除图片 ${index + 1}`}
                  disabled={disabled}
                  onClick={() =>
                    onImages((current) =>
                      current.filter((item) => item.id !== image.id),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {mode && (
          <div
            className="composer-popup"
            role="listbox"
            id={id}
            aria-label={mode === "$" ? "技能与应用" : "命令与技能"}
            ref={menu}
          >
            {matches.map((c, i) => (
              <button
                type="button"
                role="option"
                aria-selected={i === selectedIndex}
                aria-disabled={!c.enabled}
                id={`${id}-${i}`}
                key={c.key}
                title={[c.title, c.description, c.source, c.reference?.path]
                  .filter(Boolean)
                  .join(" · ")}
                aria-description={c.reference?.path}
                className={!c.enabled ? "unavailable" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(c)}
              >
                <span className="candidate-mark" aria-hidden="true">
                  ◇
                </span>
                <strong>{c.title}</strong>
                <small>
                  {c.description}
                  {!c.enabled ? " · 不可用" : ""}
                </small>
                <small className="candidate-source">{c.source}</small>
              </button>
            ))}
            {!matches.length && (
              <p>{loading ? "正在读取目录…" : error || "没有匹配项"}</p>
            )}
            {catalog?.errors.map((e) => (
              <small className="catalog-notice" key={e}>
                {e}
              </small>
            ))}
          </div>
        )}
        <textarea
          ref={input}
          aria-label={label}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-controls={mode ? id : undefined}
          aria-activedescendant={
            mode && matches.length ? `${id}-${selectedIndex}` : undefined
          }
          value={value}
          rows={1}
          disabled={disabled}
          onChange={(e) => {
            change(e.target.value);
            setCaret(e.target.selectionStart);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onPaste={(event) => void pasteImages(event)}
          placeholder={placeholder ?? (active ? "追加当前指令…" : "发送消息…")}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (
              e.key === "Tab" &&
              e.shiftKey &&
              !e.ctrlKey &&
              !e.metaKey &&
              !e.altKey &&
              onToggleMode
            ) {
              e.preventDefault();
              e.stopPropagation();
              setManual(null);
              setDismissed(true);
              onToggleMode();
              return;
            }
            if (mode && e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setManual(null);
              setDismissed(true);
              return;
            }
            if (mode && ["ArrowDown", "ArrowUp"].includes(e.key)) {
              e.preventDefault();
              setSelected(
                (selectedIndex +
                  (e.key === "ArrowDown" ? 1 : -1) +
                  Math.max(matches.length, 1)) %
                  Math.max(matches.length, 1),
              );
              return;
            }
            if (
              mode &&
              matches.length &&
              (e.key === "Tab" || e.key === "Enter") &&
              !e.shiftKey &&
              !e.ctrlKey &&
              !e.metaKey
            ) {
              e.preventDefault();
              choose(matches[selectedIndex]);
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-toolbar">
          <details className="composer-add">
            <summary aria-label="添加上下文">
              <img src="/figma/plus.svg" alt="" />
            </summary>
            <div>
              <button
                type="button"
                disabled={disabled}
                onClick={(event) => {
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                  imagePicker.current?.click();
                }}
              >
                上传文件
              </button>
              {[
                ["skills", "技能 $"],
                ["apps", "应用 $"],
                ["commands", "命令 /"],
              ].map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  onClick={(e) => {
                    setManual(key as "skills" | "apps" | "commands");
                    setSelected(0);
                    e.currentTarget.closest("details")?.removeAttribute("open");
                    input.current?.focus();
                  }}
                >
                  {label}
                </button>
              ))}
              <button type="button" onClick={() => setRefresh((n) => n + 1)}>
                刷新目录
              </button>
            </div>
          </details>
          <div className="composer-toolbar-right">
            {modeControl}
            {modelSelector && (
              <div
                className="composer-model-slot"
                onFocus={() => {
                  setManual(null);
                  setDismissed(true);
                }}
              >
                {modelSelector}
              </div>
            )}
            <div className="composer-actions">
              <button
                type="button"
                className="primary composer-send"
                data-action={stopMode ? "stop" : "send"}
                aria-label={
                  stopMode
                    ? "停止当前轮次"
                    : active
                      ? "追加指令"
                      : threadId
                        ? "开始下一轮"
                        : "派发任务"
                }
                disabled={
                  stopMode
                    ? disabled
                    : disabled ||
                      submitDisabled ||
                      readingImages ||
                      filesPending ||
                      (!value.trim() && !images.length && !files.length) ||
                      stale
                }
                onClick={stopMode ? onStop : submit}
              >
                <img
                  src={stopMode ? "/figma/stop.svg" : "/figma/arrow.svg"}
                  alt=""
                />
              </button>
            </div>
          </div>
        </div>
        {stale && (
          <small role="alert">引用已失效或工作区已变化，请重新选择。</small>
        )}
        {error && !mode && (
          <div role="alert" className="composer-error">
            {error}
            {slashInput(value) && (
              <button
                type="button"
                onClick={() => {
                  setLiteral(true);
                  setError("");
                  setDismissed(true);
                }}
              >
                按普通文本发送
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
