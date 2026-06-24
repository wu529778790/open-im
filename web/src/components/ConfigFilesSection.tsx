import { useState } from "react";

export interface ConfigFileEntry {
  id: string;
  group: string;
  label: string;
  hint: string;
  path: string;
  content: string;
  setContent: (v: string) => void;
  onSave: () => Promise<void>;
  onFormat?: () => void;
  onReset?: () => void;
  validation?: { text: string; type: "success" | "error" } | null;
}

interface Props {
  files: ConfigFileEntry[];
  forwardRef?: React.RefObject<HTMLElement | null>;
  hideHeading?: boolean;
}

function toMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

export function ConfigFilesSection({ files, forwardRef, hideHeading = false }: Props) {
  const [selectedId, setSelectedId] = useState<string>(files[0]?.id ?? "");
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" | "" }>({ text: "", type: "" });

  const groups = new Map<string, ConfigFileEntry[]>();
  for (const f of files) {
    if (!groups.has(f.group)) groups.set(f.group, []);
    groups.get(f.group)!.push(f);
  }

  const active = files.find(f => f.id === selectedId);

  return (
    <section className="section config-editor-wrap" ref={forwardRef as React.RefObject<HTMLElement>}>
      {!hideHeading && (
        <div className="section-head">
          <div>
            <h2 className="section-title">配置文件（JSON）</h2>
            <p className="section-desc">直接编辑磁盘上的文件，每张卡片有独立保存按钮。</p>
          </div>
        </div>
      )}
      {msg.text && (
        <div className={`msg ${msg.type === "success" ? "msg-ok" : "msg-err"}`} style={{ marginBottom: 12 }}>
          {msg.text}
          <button type="button" className="toast-close" style={{ float: "right" }} onClick={() => setMsg({ text: "", type: "" })}>×</button>
        </div>
      )}
      <div className="config-editor">
        <div className="config-editor-sidebar">
          {[...groups.entries()].map(([group, entries]) => (
            <div key={group}>
              <div className="file-group-label">{group}</div>
              {entries.map((f, i) => (
                <div
                  key={f.id}
                  className={`file-item${f.id === selectedId ? " active" : ""}${entries.length > 1 || true ? "" : ""}`}
                  onClick={() => setSelectedId(f.id)}
                >
                  <span className="icon">📄</span>
                  <span className="label">{f.label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="config-editor-body">
          {active ? (
            <>
              <p className="file-hint">{active.hint}</p>
              <p className="file-path">{active.path}</p>
              {(active.onFormat || active.onReset) && (
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginBottom: 8 }}>
                  {active.onFormat && <button type="button" className="btn btn-g btn-sm" onClick={active.onFormat}>格式化</button>}
                  {active.onReset && <button type="button" className="btn btn-g btn-sm" onClick={active.onReset}>重置</button>}
                </div>
              )}
              <textarea
                spellCheck={false}
                value={active.content}
                onChange={(e) => active.setContent(e.target.value)}
              />
              {active.validation && <div className={`msg mt-4 ${active.validation.type === "success" ? "msg-ok" : "msg-err"}`}>{active.validation.text}</div>}
              <div style={{ marginTop: 10 }}>
                <button type="button" className="btn btn-s btn-sm" onClick={() => void (async () => { try { await active.onSave(); setMsg({ text: "保存成功", type: "success" }); } catch (e) { setMsg({ text: toMsg(e), type: "error" }); } })()}>
                  保存
                </button>
              </div>
            </>
          ) : (
            <p style={{ color: "var(--c-text-3)", padding: 40, textAlign: "center" }}>请从左侧选择配置文件</p>
          )}
        </div>
      </div>
    </section>
  );
}