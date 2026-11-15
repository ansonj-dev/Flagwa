import { useEffect, useId, useState } from "react";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { Play, LoaderCircle } from "lucide-react";
import type { JsonRecord, JsonSchema, OpenAPI } from "../types/domain";
import { ErrorState } from "./ui";
export function resolveSchema(
  schema: JsonSchema,
  contract: OpenAPI,
): JsonSchema {
  if (schema.$ref)
    return resolveSchema(
      contract.components.schemas[schema.$ref.split("/").at(-1)!] ?? {},
      contract,
    );
  if (schema.anyOf)
    return resolveSchema(
      schema.anyOf.find((item) => item.type !== "null") ?? {},
      contract,
    );
  return schema;
}
export function defaultsFor(schema: JsonSchema, contract: OpenAPI): unknown {
  const resolved = resolveSchema(schema, contract);
  if (resolved.default !== undefined) return structuredClone(resolved.default);
  if (resolved.const !== undefined) return resolved.const;
  if (resolved.type === "object" || resolved.properties)
    return Object.fromEntries(
      Object.entries(resolved.properties ?? {})
        .filter(
          ([key, child]) =>
            resolved.required?.includes(key) ||
            resolveSchema(child, contract).default !== undefined,
        )
        .map(([key, child]) => [key, defaultsFor(child, contract)]),
    );
  if (resolved.type === "array") return [];
  if (resolved.type === "boolean") return false;
  if (resolved.type === "integer" || resolved.type === "number") return "";
  return "";
}
function Field({
  name,
  schema,
  contract,
  value,
  onChange,
  required,
  depth = 0,
}: {
  name: string;
  schema: JsonSchema;
  contract: OpenAPI;
  value: unknown;
  onChange: (value: unknown) => void;
  required: boolean;
  depth?: number;
}) {
  const resolved = resolveSchema(schema, contract),
    id = useId(),
    label = resolved.title ?? name.replaceAll("_", " ");
  const [text, setText] = useState(() =>
      JSON.stringify(value ?? (resolved.type === "object" ? {} : []), null, 2),
    ),
    [invalid, setInvalid] = useState(false);
  const object = Boolean(resolved.properties),
    array = resolved.type === "array",
    jsonObject = resolved.type === "object" && !object;
  useEffect(() => {
    if (typeof value !== "string")
      setText(JSON.stringify(value ?? (jsonObject ? {} : []), null, 2));
  }, [value, jsonObject]);
  const [open, setOpen] = useState(required || value !== undefined);
  if (depth > 5) return null;
  const control = object ? (
    <div className="schema-object">
      {Object.entries(resolved.properties ?? {}).map(([key, child]) => (
        <Field
          key={key}
          name={key}
          schema={child}
          contract={contract}
          value={(value as JsonRecord | undefined)?.[key]}
          onChange={(childValue) => {
            const next = { ...((value as JsonRecord) ?? {}) };
            if (childValue === undefined) delete next[key];
            else next[key] = childValue;
            onChange(next);
          }}
          required={Boolean(resolved.required?.includes(key))}
          depth={depth + 1}
        />
      ))}
    </div>
  ) : resolved.enum ? (
    <select
      id={id}
      value={String(value ?? "")}
      required={required}
      onChange={(event) =>
        onChange(
          resolved.type === "integer"
            ? Number(event.target.value)
            : event.target.value,
        )
      }
    >
      <option value="">Select…</option>
      {resolved.enum.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  ) : resolved.type === "boolean" ? (
    <input
      id={id}
      type="checkbox"
      checked={Boolean(value)}
      onChange={(event) => onChange(event.target.checked)}
    />
  ) : resolved.format === "date-time" ? (
    <>
      <input
        id={id}
        aria-describedby={`${id}-timezone`}
        type="datetime-local"
        step="1"
        required={required}
        value={
          typeof value === "string" && Number.isFinite(Date.parse(value))
            ? new Date(value).toISOString().slice(0, 19)
            : ""
        }
        onChange={(event) =>
          onChange(
            event.target.value
              ? new Date(`${event.target.value}Z`).toISOString()
              : "",
          )
        }
      />
      <small id={`${id}-timezone`}>UTC</small>
    </>
  ) : array || jsonObject ? (
    <>
      <textarea
        id={id}
        className="mono"
        rows={3}
        value={text}
        aria-invalid={invalid}
        onChange={(event) => {
          setText(event.target.value);
          try {
            const parsed = JSON.parse(event.target.value);
            if (
              array
                ? !Array.isArray(parsed)
                : !parsed || typeof parsed !== "object" || Array.isArray(parsed)
            )
              throw new Error();
            setInvalid(false);
            onChange(parsed);
          } catch {
            setInvalid(true);
            onChange(event.target.value);
          }
        }}
      />
      {invalid && (
        <small className="error-text">
          A valid JSON {jsonObject ? "object" : "array"} is required.
        </small>
      )}
    </>
  ) : (
    <input
      id={id}
      type={
        resolved.type === "number" || resolved.type === "integer"
          ? "number"
          : "text"
      }
      step={resolved.type === "integer" ? "1" : "any"}
      min={resolved.minimum}
      max={resolved.maximum}
      minLength={resolved.minLength}
      required={required}
      value={value == null ? "" : String(value)}
      onChange={(event) =>
        onChange(
          ["integer", "number"].includes(String(resolved.type)) &&
            event.target.value !== ""
            ? Number(event.target.value)
            : event.target.value,
        )
      }
    />
  );
  return (
    <div className={`schema-field ${object ? "object-field" : ""}`}>
      {!required && (
        <label className="optional-switch">
          <input
            type="checkbox"
            checked={open}
            onChange={(event) => {
              setOpen(event.target.checked);
              onChange(
                event.target.checked
                  ? defaultsFor(schema, contract)
                  : undefined,
              );
            }}
          />
          <span>
            {open ? "Include" : "Optional"} {label}
          </span>
        </label>
      )}
      {(required || open) && (
        <>
          {object ? (
            <h4>
              {label}
              {required && <span aria-label="required"> *</span>}
            </h4>
          ) : (
            <label htmlFor={id}>
              {label}
              {required && <span aria-label="required"> *</span>}
            </label>
          )}
          {control}
          {resolved.description && <small>{resolved.description}</small>}
        </>
      )}
    </div>
  );
}
export function SchemaForm({
  schema,
  contract,
  seed = {},
  onSubmit,
  label = "Submit request",
  disabled = false,
}: {
  schema: JsonSchema;
  contract: OpenAPI;
  seed?: JsonRecord;
  onSubmit: (values: JsonRecord) => Promise<void>;
  label?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<JsonRecord>({}),
    [errors, setErrors] = useState<string[]>([]),
    [failure, setFailure] = useState<unknown>(),
    [pending, setPending] = useState(false);
  const seedKey = JSON.stringify(seed),
    schemaKey = schema.$ref ?? JSON.stringify(schema);
  useEffect(() => {
    setValue({ ...(defaultsFor(schema, contract) as JsonRecord), ...seed });
    setErrors([]);
    setFailure(undefined);
  }, [schemaKey, seedKey]);
  const resolved = resolveSchema(schema, contract);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(undefined);
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile({
      ...schema,
      components: contract.components,
    });
    if (!validate(value)) {
      setErrors(
        (validate.errors ?? []).map(
          (error) => `${error.instancePath || "Request"} ${error.message}`,
        ),
      );
      return;
    }
    setErrors([]);
    setPending(true);
    try {
      await onSubmit(value);
    } catch (error) {
      setFailure(error);
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="schema-form" onSubmit={submit}>
      <fieldset disabled={disabled || pending}>
        {Object.entries(resolved.properties ?? {}).map(([key, child]) => (
          <Field
            key={`${schemaKey}-${seedKey}-${key}`}
            name={key}
            schema={child}
            contract={contract}
            value={value[key]}
            required={Boolean(resolved.required?.includes(key))}
            onChange={(next) =>
              setValue((current) => {
                const updated = { ...current };
                if (next === undefined) delete updated[key];
                else updated[key] = next;
                return updated;
              })
            }
          />
        ))}
        <button className="primary-button full" type="submit">
          {pending ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Play size={16} />
          )}{" "}
          {label}
        </button>
      </fieldset>
      {errors.length > 0 && (
        <ul className="error-text" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      {Boolean(failure) && <ErrorState error={failure} />}
    </form>
  );
}
