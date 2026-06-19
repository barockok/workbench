import { useState } from "react";
import { submitApiKey, ApiKeyField } from "../api";

interface Props {
  integration: string;
  displayName?: string;
  fields: ApiKeyField[];
  onClose: () => void;
  onSuccess: () => void;
}

// Connect form for apikey integrations (e.g. New Relic): the user enters the
// credential plus any config fields (region, etc.), which the server stores as
// the connection. Mirrors the field spec declared in the plugin manifest.
export default function ApiKeyAuthModal({ integration, displayName, fields, onClose, onSuccess }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.options?.[0] ?? ""]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only required (non-optional) fields gate submission.
  const complete = fields.every((f) => f.optional || (values[f.key] ?? "").trim());

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      await submitApiKey(integration, values);
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connect failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="modal-title">Connect <span>{displayName || integration}</span></h2>
          <button onClick={onClose} className="btn-ghost" aria-label="Close">Close</button>
        </div>

        <div className="apikey-form">
          {fields.map((f) => (
            <div className="apikey-field" key={f.key}>
              <label className="apikey-field-label" htmlFor={`apikey-${f.key}`}>
                {f.label}{" "}
                {f.optional ? (
                  <span className="apikey-opt">(optional)</span>
                ) : (
                  <span className="apikey-req">*</span>
                )}
              </label>
              {f.description && <p className="apikey-field-desc">{f.description}</p>}
              {f.options ? (
                <select
                  id={`apikey-${f.key}`}
                  className="session-transfer-paste"
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                >
                  {f.options.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  id={`apikey-${f.key}`}
                  className="session-transfer-paste"
                  type={f.secret ? "password" : "text"}
                  autoComplete="off"
                  placeholder={f.placeholder}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
            </div>
          ))}
        </div>

        {error && <div className="modal-error">ERR — {error}</div>}

        <div className="modal-foot">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={handleSubmit} disabled={saving || !complete} className="btn-connect">
            {saving ? "Connecting…" : "Connect account"}
          </button>
        </div>
      </div>
    </div>
  );
}
