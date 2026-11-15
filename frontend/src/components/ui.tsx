import {
  AlertCircle,
  ArrowUpRight,
  LoaderCircle,
  X,
  Check,
  Satellite,
  TriangleAlert,
  FlaskConical,
} from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ApiError } from "../services/api-client";
export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  );
}
export function Loading({
  label = "Reading backend records",
}: {
  label?: string;
}) {
  return (
    <div className="state" role="status">
      <LoaderCircle className="spin" size={19} />
      <span>{label}</span>
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="state error-state" role="alert">
      <AlertCircle size={20} />
      <div>
        <strong>
          {error instanceof Error
            ? error.message
            : "This evidence is unavailable."}
        </strong>
        {error instanceof ApiError && (
          <small>
            {error.code}
            {error.requestId && (
              <>
                <br />
                Request <span className="mono">{error.requestId}</span>
              </>
            )}
          </small>
        )}
        {retry && (
          <button className="text-button" onClick={retry}>
            Retry request <ArrowUpRight size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="state empty-state">
      <Satellite size={23} />
      <div>
        <strong>{title}</strong>
        {children && <p>{children}</p>}
      </div>
    </div>
  );
}
export function StatusBadge({
  status,
  experimental = false,
}: {
  status?: string;
  experimental?: boolean;
}) {
  const verified = status === "validated" || status === "approved",
    Icon = experimental ? FlaskConical : verified ? Check : TriangleAlert;
  return (
    <span
      className={`badge ${experimental ? "experimental" : verified ? "verified" : "candidate"}`}
    >
      <Icon size={12} />
      {experimental
        ? "Experimental"
        : verified
          ? "Validated"
          : status?.replaceAll("_", " ") || "Unverified"}
    </span>
  );
}
export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="section-title">
      <h3>{children}</h3>
      {action}
    </div>
  );
}
export function Close({ onClick }: { onClick: () => void }) {
  return (
    <IconButton label="Close" onClick={onClick}>
      <X size={18} />
    </IconButton>
  );
}
export function JsonView({ value }: { value: unknown }) {
  return <pre className="json-view">{JSON.stringify(value, null, 2)}</pre>;
}
