"use client";

import { useEffect, useMemo, useState } from "react";

type AdminData = {
  generatedAt: string;
  windowMinutes: number;
  summary: {
    users: number;
    smsEnabled: number;
    due: number;
    recentSent: number;
    recentFailed: number;
  };
  dueUsers: Array<{
    id: string;
    display_name: string | null;
    location: string;
    phone_e164: string;
    daily_send_time: string;
    timezone: string;
    localTime: string;
  }>;
  deliveries: Array<{
    id: string;
    user_id: string;
    delivery_date: string;
    status: string;
    provider: string | null;
    error: string | null;
    recommendation_id: string | null;
    created_at: string;
  }>;
  recommendations: Array<{
    id: string;
    user_id: string;
    recommendation_date: string;
    source: string;
    sms_copy: string;
    created_at: string;
  }>;
};

type RunResult = {
  checked: number;
  due: number;
  sent: number;
  dryRun: number;
  skipped: number;
  failed: number;
};

function statusClass(status: string) {
  if (status === "sent") {
    return "good";
  }
  if (status === "failed") {
    return "bad";
  }
  if (status === "skipped") {
    return "warn";
  }
  return "soft";
}

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [windowMinutes, setWindowMinutes] = useState(1440);
  const [data, setData] = useState<AdminData | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const stored = window.sessionStorage.getItem("sunwise-admin-secret");
    if (stored) {
      setSecret(stored);
    }
  }, []);

  const authHeaders = useMemo(
    () => ({
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json"
    }),
    [secret]
  );

  const refresh = async () => {
    if (!secret) {
      setMessage("Enter the admin secret.");
      return;
    }

    setIsLoading(true);
    setMessage("");
    window.sessionStorage.setItem("sunwise-admin-secret", secret);

    try {
      const response = await fetch(`/api/admin/digest?windowMinutes=${windowMinutes}`, {
        headers: authHeaders
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Could not load admin status");
      }
      setData(payload as AdminData);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load admin status");
    } finally {
      setIsLoading(false);
    }
  };

  const runDigest = async () => {
    if (!secret) {
      setMessage("Enter the admin secret.");
      return;
    }

    setIsLoading(true);
    setMessage("");
    window.sessionStorage.setItem("sunwise-admin-secret", secret);

    try {
      const response = await fetch("/api/admin/digest", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ limit: 25, windowMinutes })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Digest run failed");
      }
      setRunResult(payload as RunResult);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Digest run failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <p className="muted">Sunwise operations</p>
          <h1>Digest admin</h1>
        </div>
        <a href="/">Back to app</a>
      </header>

      <section className="admin-controls">
        <label className="field">
          <span>Admin secret</span>
          <input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder="CRON_SECRET or ADMIN_SECRET"
          />
        </label>
        <label className="field">
          <span>Due window: {windowMinutes} minutes</span>
          <input
            type="range"
            min="15"
            max="1440"
            step="15"
            value={windowMinutes}
            onChange={(event) => setWindowMinutes(Number(event.target.value))}
          />
        </label>
        <button className="secondary-button" type="button" onClick={refresh} disabled={isLoading}>
          {isLoading ? "Working..." : "Refresh status"}
        </button>
        <button className="save-button" type="button" onClick={runDigest} disabled={isLoading}>
          Run digest now
        </button>
      </section>

      {message && <p className="error-text admin-message">{message}</p>}

      {runResult && (
        <section className="admin-panel">
          <h2>Last run</h2>
          <div className="admin-stats">
            <span>Checked {runResult.checked}</span>
            <span>Due {runResult.due}</span>
            <span>Sent {runResult.sent}</span>
            <span>Dry run {runResult.dryRun}</span>
            <span>Skipped {runResult.skipped}</span>
            <span>Failed {runResult.failed}</span>
          </div>
        </section>
      )}

      {data && (
        <>
          <section className="admin-stats-grid">
            <div>
              <span>Users</span>
              <strong>{data.summary.users}</strong>
            </div>
            <div>
              <span>SMS enabled</span>
              <strong>{data.summary.smsEnabled}</strong>
            </div>
            <div>
              <span>Due now</span>
              <strong>{data.summary.due}</strong>
            </div>
            <div>
              <span>Recent failed</span>
              <strong>{data.summary.recentFailed}</strong>
            </div>
          </section>

          <section className="admin-panel">
            <div className="admin-section-title">
              <h2>Due users</h2>
              <p>Generated {new Date(data.generatedAt).toLocaleString()}</p>
            </div>
            <div className="admin-table">
              <div className="admin-row head">
                <span>User</span>
                <span>Location</span>
                <span>Phone</span>
                <span>Local time</span>
              </div>
              {data.dueUsers.length === 0 ? (
                <p className="admin-empty">No users due in this window.</p>
              ) : (
                data.dueUsers.map((user) => (
                  <div className="admin-row" key={user.id}>
                    <span>{user.display_name || user.id.slice(0, 8)}</span>
                    <span>{user.location}</span>
                    <span>{user.phone_e164}</span>
                    <span>{user.localTime}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="admin-panel">
            <h2>Recent deliveries</h2>
            <div className="admin-table">
              <div className="admin-row head">
                <span>Date</span>
                <span>Status</span>
                <span>Provider</span>
                <span>Error</span>
              </div>
              {data.deliveries.map((delivery) => (
                <div className="admin-row" key={delivery.id}>
                  <span>{delivery.delivery_date}</span>
                  <span className={`status-pill ${statusClass(delivery.status)}`}>{delivery.status}</span>
                  <span>{delivery.provider || "none"}</span>
                  <span>{delivery.error || "none"}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="admin-panel">
            <h2>Recent recommendations</h2>
            <div className="admin-recommendations">
              {data.recommendations.map((recommendation) => (
                <article key={recommendation.id}>
                  <strong>{recommendation.recommendation_date}</strong>
                  <span>{recommendation.source}</span>
                  <p>{recommendation.sms_copy}</p>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
