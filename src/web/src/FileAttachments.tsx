import { FileText, RotateCw, X } from "lucide-react";
import { formatFileSize, removeFile, retryFile } from "./composer-files";
import type { FileDraft } from "./composer-files";

export function FileAttachments({
  files,
  scope,
  cwd,
  tid,
  disabled,
}: {
  files: FileDraft[];
  scope: string;
  cwd: string;
  tid?: string;
  disabled: boolean;
}) {
  if (!files.length) return null;
  return (
    <div className="composer-files" aria-label="待发送文件">
      {files.map((file) => (
        <div className="composer-file" key={file.id} data-status={file.status}>
          <FileText size={18} aria-hidden="true" />
          <div className="composer-file-info">
            <span className="composer-file-name" title={file.name}>
              {file.name}
            </span>
            <small
              role={file.status === "error" ? "alert" : "status"}
              title={file.error}
            >
              {formatFileSize(file.size)} ·{" "}
              {file.status === "ready"
                ? "已就绪"
                : file.status === "uploading"
                  ? "正在上传…"
                  : file.error || "上传失败"}
            </small>
          </div>
          {file.status === "error" && (
            <button
              type="button"
              className="quiet"
              aria-label={`重试上传 ${file.name}`}
              disabled={disabled}
              onClick={() => retryFile(scope, file, cwd, tid)}
            >
              <RotateCw size={16} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="quiet"
            aria-label={`移除文件 ${file.name}`}
            disabled={disabled}
            onClick={() => removeFile(scope, file.id)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
