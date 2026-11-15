import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LockKeyhole, LogOut, ShieldCheck } from "lucide-react";
import { localApi, useOperator } from "../services/data";
import { Close, ErrorState, Loading } from "./ui";
export function OperatorAccess({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null),
    session = useOperator(),
    queryClient = useQueryClient();
  const [password, setPassword] = useState(""),
    [error, setError] = useState<unknown>(),
    [pending, setPending] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    const element = dialog.current;
    const close = () => onClose();
    element?.addEventListener("close", close);
    return () => element?.removeEventListener("close", close);
  }, [onClose]);
  async function authenticate(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(undefined);
    try {
      await localApi.post("/operator/session", { password });
      setPassword("");
      await queryClient.invalidateQueries({ queryKey: ["operator"] });
      onClose();
    } catch (error) {
      setError(error);
      setPassword("");
    } finally {
      setPending(false);
    }
  }
  async function logout() {
    try {
      await localApi.post("/operator/logout", {});
      await queryClient.invalidateQueries({ queryKey: ["operator"] });
      onClose();
    } catch (error) {
      setError(error);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="operator-dialog"
      aria-labelledby="operator-title"
    >
      <div className="dialog-title">
        <LockKeyhole />
        <h2 id="operator-title">Operator access</h2>
        <Close onClick={onClose} />
      </div>
      {session.isPending ? (
        <Loading />
      ) : session.error ? (
        <ErrorState error={session.error} />
      ) : !session.data?.enabled ? (
        <p>
          Restricted operations are disabled on this deployment. Public
          observation, comparison, provenance and exports remain available.
          Server-side operator configuration is required to submit processing or
          validation jobs.
        </p>
      ) : session.data.authorized ? (
        <>
          <p>
            <ShieldCheck size={18} /> This browser has a short-lived operator
            session.
          </p>
          <button className="secondary-button" onClick={logout}>
            <LogOut size={16} /> End session
          </button>
        </>
      ) : (
        <form onSubmit={authenticate}>
          <label htmlFor="operator-password">Operator passphrase</label>
          <input
            autoFocus
            id="operator-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={16}
          />
          <button disabled={pending} className="primary-button" type="submit">
            {pending ? "Verifying…" : "Start restricted session"}
          </button>
        </form>
      )}
      {Boolean(error) && <ErrorState error={error} />}
    </dialog>
  );
}
