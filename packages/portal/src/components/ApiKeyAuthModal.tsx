import { useState } from "react";
import { submitApiKey, ApiKeyField } from "../api";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input, Select } from "./ui/Input";

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
    <Modal
      open
      onClose={onClose}
      title={<>Connect <span>{displayName || integration}</span></>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving || !complete}>
            {saving ? "Connecting…" : "Connect account"}
          </Button>
        </>
      }
    >
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
              <Select
                id={`apikey-${f.key}`}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              >
                {f.options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            ) : f.multiline ? (
              <textarea
                id={`apikey-${f.key}`}
                className="ui-input"
                rows={6}
                style={{ fontFamily: "monospace", resize: "vertical" }}
                autoComplete="off"
                placeholder={f.placeholder}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            ) : (
              <Input
                id={`apikey-${f.key}`}
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

      {error && <div className="ui-form-error">{error}</div>}
    </Modal>
  );
}
