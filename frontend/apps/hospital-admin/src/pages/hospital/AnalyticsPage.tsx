import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart, Cell } from "recharts";
import { useAdmin } from "../../store/AdminStore";
import { LiveBanner } from "./InsightPages";
import { EmptyState, MetricCard } from "../../components/common/ui";

const CHART_BLUE = "#1769AA";
const STATUS_COLORS = ["#2E8B68", "#168C8C", "#C58A22", "#1769AA", "#C94C4C"];

export default function AnalyticsPage() {
  const { analytics, loading, backendError, refreshAll } = useAdmin();

  if (loading && !analytics) {
    return (
      <div className="space-y-4">
        <div><h1 className="page-title">Analytics</h1><p className="page-sub mt-1">Scheduling and operational performance for your hospital.</p></div>
        <LiveBanner text="Live analytics" />
        <div className="card-base p-5 text-sm text-ink-secondary">Loading analytics…</div>
      </div>
    );
  }

  if (backendError && !analytics) {
    return (
      <div className="space-y-4">
        <div><h1 className="page-title">Analytics</h1><p className="page-sub mt-1">Scheduling and operational performance for your hospital.</p></div>
        <LiveBanner text="Live analytics" />
        <div className="card-base p-5">
          <p role="alert" className="text-[0.83rem] font-semibold text-danger">{backendError}</p>
          <button onClick={() => void refreshAll()} className="mt-2 text-[0.8rem] font-bold text-healthcare hover:underline">Retry</button>
        </div>
      </div>
    );
  }

  if (!analytics || analytics.appointments_total === 0) {
    return (
      <div className="space-y-4">
        <div><h1 className="page-title">Analytics</h1><p className="page-sub mt-1">Scheduling and operational performance for your hospital.</p></div>
        <LiveBanner text="Live analytics" />
        <div className="card-base"><EmptyState title="No analytics data yet" body="Bookings will appear here once the backend records appointments." /></div>
      </div>
    );
  }

  const days = Object.entries(analytics.bookings_per_day_30d).sort(([a], [b]) => (a < b ? -1 : 1));
  const volume = days.slice(-14).map(([day, appointments]) => ({ day: day.slice(5), appointments }));
  const breakdown = Object.entries(analytics.appointments_by_state).map(([name, value]) => ({ name, value }));
  const total = analytics.appointments_total;
  const confirmed = analytics.appointments_by_state.confirmed ?? 0;
  const cancelled = analytics.appointments_by_state.cancelled ?? 0;
  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Analytics</h1><p className="page-sub mt-1">Scheduling and operational performance for your hospital.</p></div>
      <LiveBanner text="Live analytics" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <MetricCard label="Appointments (30d)" value={String(total)} sub="all states" />
        <MetricCard label="Confirmed share" value={total > 0 ? `${Math.round((confirmed / total) * 100)}%` : "—"} sub="confirmed / total" tone="success" />
        <MetricCard label="Cancellation rate" value={total > 0 ? `${((cancelled / total) * 100).toFixed(1)}%` : "—"} sub={`${cancelled} cancelled`} />
        <MetricCard label="AI avg latency" value={analytics.tool_success_avg_latency_ms != null ? `${Math.round(analytics.tool_success_avg_latency_ms)} ms` : "—"} sub="per execution" tone="teal" />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <section className="card-base p-5">
          <h2 className="section-title">Bookings per day</h2>
          <div className="h-56 mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={volume} margin={{ top: 5, right: 10, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="#DCE5EA" strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="appointments" stroke={CHART_BLUE} strokeWidth={2} dot={false} name="Bookings" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card-base p-5">
          <h2 className="section-title">Status breakdown</h2>
          <div className="h-56 mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={breakdown} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid stroke="#DCE5EA" strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                <Tooltip />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {breakdown.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
}
