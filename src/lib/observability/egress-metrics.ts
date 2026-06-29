type MetricDetailValue = string | number | boolean | null;

type MetricEvent = {
  name: string;
  at: string;
  details?: Record<string, MetricDetailValue>;
};

type RealtimeSnapshot = {
  count: number;
  channels: string[];
  updatedAt: string;
};

type ClientEgressMetricsState = {
  counters: Record<string, number>;
  realtime: Record<string, RealtimeSnapshot>;
  lastEvents: MetricEvent[];
};

const MAX_EVENT_HISTORY = 50;

function getMetricsState(): ClientEgressMetricsState | null {
  if (typeof window === 'undefined') return null;

  const root = globalThis as typeof globalThis & {
    __DCAU_EGRESS_METRICS__?: ClientEgressMetricsState;
  };

  if (!root.__DCAU_EGRESS_METRICS__) {
    root.__DCAU_EGRESS_METRICS__ = {
      counters: {},
      realtime: {},
      lastEvents: [],
    };
  }

  return root.__DCAU_EGRESS_METRICS__;
}

function shouldRecordClientEgressMetrics(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export function recordClientEgressMetric(
  name: string,
  details?: Record<string, MetricDetailValue>,
): void {
  if (!shouldRecordClientEgressMetrics()) return;

  const state = getMetricsState();
  if (!state) return;

  state.counters[name] = (state.counters[name] || 0) + 1;
  state.lastEvents.push({
    name,
    at: new Date().toISOString(),
    details,
  });

  if (state.lastEvents.length > MAX_EVENT_HISTORY) {
    state.lastEvents.splice(0, state.lastEvents.length - MAX_EVENT_HISTORY);
  }

  console.debug('[egress]', name, details || {});
}

function readChannelName(channel: unknown): string {
  if (!channel || typeof channel !== 'object') return 'unknown';
  const record = channel as Record<string, unknown>;
  const topic = typeof record.topic === 'string' ? record.topic : null;
  const subTopic = typeof record.subTopic === 'string' ? record.subTopic : null;
  return topic || subTopic || 'unknown';
}

export function recordRealtimeChannelSnapshot(category: string, channels: unknown[]): void {
  if (!shouldRecordClientEgressMetrics()) return;

  const state = getMetricsState();
  if (!state) return;

  const names = channels.map(readChannelName).sort();
  state.realtime[category] = {
    count: names.length,
    channels: names,
    updatedAt: new Date().toISOString(),
  };

  console.debug('[egress:realtime]', category, {
    count: names.length,
    channels: names,
  });
}
