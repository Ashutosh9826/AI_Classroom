import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

const CHART_COLORS = [
  '#6750A4', '#E8DEF8', '#625B71', '#CCC2DC',
  '#7D5260', '#FFD8E4', '#49454F', '#B4C6E7',
  '#009688', '#FF9800', '#4CAF50', '#F44336',
];

export default function StaticChartBlock({ chartType = 'bar', title, dataKey = 'value', data = [] }) {
  const safeData = Array.isArray(data) && data.length > 0
    ? data
    : [{ name: 'No Data', [dataKey]: 0 }];

  const renderChart = () => {
    if (chartType === 'pie') {
      return (
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={safeData}
              dataKey={dataKey}
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={100}
              label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
              labelLine={true}
            >
              {safeData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === 'line') {
      return (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={safeData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--md-sys-color-outline-variant, #ccc)" opacity={0.4} />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke="#6750A4"
              strokeWidth={2}
              dot={{ r: 4, fill: '#6750A4' }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      );
    }

    // Default: bar chart
    return (
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={safeData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--md-sys-color-outline-variant, #ccc)" opacity={0.4} />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Legend />
          <Bar dataKey={dataKey} radius={[6, 6, 0, 0]}>
            {safeData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-outline-variant/20 bg-surface-container-low">
        <span className="material-symbols-outlined text-sm text-primary">bar_chart</span>
        <span className="text-xs font-bold uppercase tracking-widest text-outline">
          {chartType === 'pie' ? 'Pie' : chartType === 'line' ? 'Line' : 'Bar'} Chart
        </span>
      </div>
      {title && (
        <p className="text-center text-base font-semibold text-on-surface pt-4 pb-1">{title}</p>
      )}
      <div className="px-4 pb-4 pt-2">
        {renderChart()}
      </div>
    </div>
  );
}
