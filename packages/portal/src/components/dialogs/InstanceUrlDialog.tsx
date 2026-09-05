import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import type { InstanceConfig } from "../../api";

// Self-hosted integrations declare an instance origin. Replaces window.prompt,
// which offered no label, no placeholder and no way to explain the field.
export function InstanceUrlDialog({
  open,
  config,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  config: InstanceConfig;
  onSubmit: (url: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(config.default);

  function submit() {
    onSubmit(value.trim() || config.default);
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Where does this run?"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={submit}>Continue</Button>
        </>
      }
    >
      <label className="ui-field">
        <span className="ui-field-label">{config.label}</span>
        <Input
          value={value}
          placeholder={config.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
      </label>
    </Modal>
  );
}
