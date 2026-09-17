import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart, Cell } from "recharts";
import { STATUS_BREAKDOWN, VOLUME_7D } from "../../mock/ops";
import { useAdmin } from "../../store/AdminStore";
import { LiveBanner } from "./InsightPages";
import { MetricCard } from "../../components/common/ui";

const CHART_BLUE = "#1769AA";
const CHART_TEAL = "#168C8C";
const STATUS_COLORS = ["#2E8B68", "#168C8C", "#C58A22", "#1769AA", "#C94C4C"];

export default function AnalyticsPage() {
  const { live, analytics } = useAdmin();

  if (live && analytics) {
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

  return (
    <div className="space-y-4">
      <div><h1 className="page-title">Analytics</h1><p className="page-sub mt-1">Scheduling and operational performance (mock data).</p></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <MetricCard label="Appointments (7d)" value="278" sub="+6% vs prior week" />
        <MetricCard label="Booking success" value="96.4%" sub="confirmed / requested" tone="success" />
        <MetricCard label="Cancellation rate" value="3.2%" sub="9 cancelled" />
        <MetricCard label="Form completion" value="81%" sub="pre-visit" tone="teal" />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <section className="card-base p-5">
          <h2 className="section-title">Appointments over time</h2>
          <div className="h-56 mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={VOLUME_7D} margin={{ top: 5, right: 10, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="#DCE5EA" strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="appointments" stroke={CHART_BLUE} strokeWidth={2} dot={false} name="Appointments" />
                <Line type="monotone" dataKey="success" stroke={CHART_TEAL} strokeWidth={2} dot={false} strokeDasharray="4 3" name="Confirmed" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card-base p-5">
          <h2 className="section-title">Status breakdown</h2>
          <div className="h-56 mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={STATUS_BREAKDOWN} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid stroke="#DCE5EA" strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                <Tooltip />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {STATUS_BREAKDOWN.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <MetricCard label="Doctor utilization" value="78%" sub="booked / available hours" tone="teal" />
        <MetricCard label="AI capability success" value="97.2%" sub="1,284 executions" tone="success" />
        <MetricCard label="Integration success" value="96.6%" sub="Mock EHR" />
        <MetricCard label="Workflow success" value="98.1%" sub="all flows" tone="success" />
      </div>
    </div>
  );
}
