import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart, Cell } from "recharts";
import { Link } from "react-router-dom";
import { useAdmin } from "../../store/AdminStore";
import { InsightsTabs, LiveBanner } from "./InsightPages";
import { EmptyState } from "../../components/common/ui";

const CHART_BLUE = "#1769AA";
const CHART_GRID = "#DCE5EA";
const CHART_TICK = { fontSize: 11, fill: "#617486" };
const STATUS_COLORS = ["#2E8B68", "#168C8C", "#1769AA", "#C58A22", "#C94C4C"];

function LoadingShell({ text }: { text: string }) {
  const { refreshSection } = useAdmin();
  return (
    <div className="space-y-4">
      <AnalyticsHead banner={<LiveBanner text="Live analytics" onRefresh={() => void refreshSection("insights")} />} />
      <div className="card-base p-5 text-sm text-ink-secondary">{text}</div>
    </div>
  );
}

function AnalyticsHead({ banner, count }: { banner: React.ReactNode; count?: string }) {
  return (
    <div>
      <p className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-teal-dark">Insights</p>
      <div className="flex items-start justify-between gap-3 flex-wrap mt-1.5">
        <div className="min-w-0">
          <h1 className="text-[1.45rem] sm:text-[1.7rem] font-extrabold text-navy tracking-tight leading-tight">
            Analytics {count && <span className="text-[0.95rem] font-bold text-ink-faint tabular-nums align-middle">{count}</span>}
          </h1>
          <p className="text-[0.85rem] text-ink-secondary mt-1">Scheduling and operational performance for your hospital.</p>
        </div>
        {banner}
      </div>
      <div className="mt-4"><InsightsTabs /></div>
    </div>
  );
}

export default function AnalyticsPage() {
  const { analytics, loading, backendError, refreshSection } = useAdmin();

  if (loading && !analytics) return <LoadingShell text="Loading analytics…" />;

  if (backendError && !analytics) {
    return (
      <div className="space-y-4">
        <AnalyticsHead banner={<LiveBanner text="Live analytics" onRefresh={() => void refreshSection("insights")} />} />
        <div className="card-base p-5">
          <p role="alert" className="text-[0.83rem] font-semibold text-danger">{backendError}</p>
          <button onClick={() => void refreshSection("insights")} className="mt-2 text-[0.8rem] font-bold text-healthcare hover:underline">Retry</button>
        </div>
      </div>
    );
  }

  if (!analytics || analytics.appointments_total === 0) {
    return (
      <div className="space-y-4">
        <AnalyticsHead banner={<LiveBanner text="Live analytics" onRefresh={() => void refreshSection("insights")} />} />
        <div className="card-base"><EmptyState title="No analytics data yet" body="Bookings will appear here once the backend records appointments." /></div>
      </div>
    );
  }

  const days = Object.entries(analytics.bookings_per_day_30d).sort(([a], [b]) => (a < b ? -1 : 1));
  const volume = days.slice(-14).map(([day, appointments]) => ({ day: day.slice(5), appointments }));
  const breakdown = Object.entries(analytics.appointments_by_state).map(([name, value]) => ({ name: name.replace("_", " "), value }));
  const total = analytics.appointments_total;
  const confirmed = analytics.appointments_by_state.confirmed ?? 0;
  const cancelled = analytics.appointments_by_state.cancelled ?? 0;
  const range = volume.length > 0 ? `${volume[0].day} – ${volume[volume.length - 1].day}` : "";

  return (
    <div className="space-y-4">
      <AnalyticsHead
        count={`${total}`}
        banner={<LiveBanner text="Live analytics" onRefresh={() => void refreshSection("insights")} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {[
          { label: "Appointments (30d)", value: String(total), sub: "all states", tone: "text-navy" },
          { label: "Confirmed share", value: total > 0 ? `${Math.round((confirmed / total) * 100)}%` : "—", sub: `${confirmed} confirmed`, tone: "text-success" },
          { label: "Cancellation rate", value: total > 0 ? `${((cancelled / total) * 100).toFixed(1)}%` : "—", sub: `${cancelled} cancelled`, tone: "text-navy" },
          { label: "AI avg latency", value: analytics.tool_success_avg_latency_ms != null ? `${Math.round(analytics.tool_success_avg_latency_ms)} ms` : "—", sub: "per execution", tone: "text-teal-dark" },
        ].map((m) => (
          <div key={m.label} className="card-base p-4">
            <p className="text-[0.7rem] font-bold uppercase tracking-wide text-ink-faint">{m.label}</p>
            <p className={`text-[1.6rem] font-extrabold tabular-nums leading-tight mt-1 ${m.tone}`}>{m.value}</p>
            <p className="text-[0.74rem] text-ink-secondary mt-0.5">{m.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="card-base p-5" aria-label="Bookings per day">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="text-[0.95rem] font-bold text-navy tracking-tight">Bookings per day</h2>
            <p className="text-[0.72rem] text-ink-faint tabular-nums">{range}</p>
          </div>
          <div className="h-56 mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={volume} margin={{ top: 5, right: 10, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={CHART_TICK} />
                <YAxis tick={CHART_TICK} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="appointments" stroke={CHART_BLUE} strokeWidth={2} dot={false} name="Bookings" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[0.74rem] text-ink-secondary mt-2">
            {confirmed} of {total} bookings confirmed · <Link to="/appointments" className="font-bold text-healthcare hover:underline">View appointments</Link>
          </p>
        </section>
        <section className="card-base p-5" aria-label="Status breakdown">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="text-[0.95rem] font-bold text-navy tracking-tight">Status breakdown</h2>
            <p className="text-[0.72rem] text-ink-faint tabular-nums">{total} total</p>
          </div>
          <div className="h-56 mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={breakdown} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
                <XAxis type="number" tick={CHART_TICK} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={CHART_TICK} width={110} />
                <Tooltip />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {breakdown.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[0.74rem] text-ink-secondary mt-2">
            {cancelled} cancelled ({total > 0 ? ((cancelled / total) * 100).toFixed(1) : "0.0"}%) · <Link to="/ops" className="font-bold text-healthcare hover:underline">Review recovery</Link>
          </p>
        </section>
      </div>
    </div>
  );
}
