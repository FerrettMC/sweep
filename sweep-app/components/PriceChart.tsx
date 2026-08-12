// components/PriceChart.tsx
//
// Price history as a column chart, drawn with plain Views.
//
// Deliberately no charting library: every RN chart lib pulls in react-native-svg,
// which is a native module, and this project ships a prebuilt android/ folder —
// adding one would force a full rebuild. A price series is a step function with
// a handful of points, which columns render honestly.

import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, type } from "@/constants/theme";
import { formatChartDate, formatPrice, formatPriceShort } from "@/lib/format";

export interface PricePoint {
  price: number;
  checkedAt: string;
}

interface Props {
  history: PricePoint[];
  currentPrice: number | null;
  height?: number;
  /** How many columns to render. Older points are downsampled to fit. */
  maxColumns?: number;
}

export default function PriceChart({
  history,
  currentPrice,
  height = 160,
  maxColumns = 32,
}: Props) {
  const chart = useMemo(
    () => buildChart(history, maxColumns),
    [history, maxColumns],
  );

  if (!chart) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyTitle}>No price history yet</Text>
        <Text style={styles.emptyBody}>
          Sweep records a point each time the price changes. Check back after the
          next scan.
        </Text>
      </View>
    );
  }

  const { columns, low, high, range } = chart;

  return (
    <View>
      <View style={[styles.plot, { height }]}>
        {/* Axis labels sit behind the columns so they never shift the layout. */}
        <View style={styles.axis} pointerEvents="none">
          <Text style={styles.axisLabel}>{formatPriceShort(high)}</Text>
          <Text style={styles.axisLabel}>{formatPriceShort(low)}</Text>
        </View>

        <View style={styles.columns}>
          {columns.map((column, index) => {
            // A flat series has zero range; render every column at a readable
            // mid height rather than collapsing them all to nothing.
            const ratio = range === 0 ? 0.5 : (column.price - low) / range;
            const isLow = column.price === low;
            const isLast = index === columns.length - 1;

            return (
              <View key={`${column.checkedAt}-${index}`} style={styles.columnSlot}>
                <View
                  style={[
                    styles.column,
                    {
                      // Floor at 6% so the cheapest point stays visible instead
                      // of rendering as a zero-height sliver.
                      height: `${6 + ratio * 94}%`,
                      backgroundColor: isLast
                        ? colors.accent
                        : isLow
                          ? colors.success
                          : colors.surfaceRaised,
                    },
                  ]}
                />
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerDate}>
          {formatChartDate(columns[0].checkedAt)}
        </Text>
        <View style={styles.legend}>
          <Legend color={colors.success} label={`Low ${formatPrice(low)}`} />
          <Legend color={colors.accent} label={`Now ${formatPrice(currentPrice ?? high)}`} />
        </View>
        <Text style={styles.footerDate}>
          {formatChartDate(columns[columns.length - 1].checkedAt)}
        </Text>
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function buildChart(history: PricePoint[], maxColumns: number) {
  if (history.length === 0) return null;

  const columns = downsample(history, maxColumns);
  const prices = columns.map((c) => c.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);

  return { columns, low, high, range: high - low };
}

/**
 * Keep the most recent points at full resolution and thin out older ones.
 * A price series matters most at its right-hand edge — that's the price you'd
 * pay today — so uniform sampling would throw away the interesting part.
 */
function downsample(history: PricePoint[], maxColumns: number): PricePoint[] {
  if (history.length <= maxColumns) return history;

  const recentCount = Math.floor(maxColumns / 2);
  const recent = history.slice(-recentCount);
  const older = history.slice(0, -recentCount);

  const olderSlots = maxColumns - recentCount;
  const step = older.length / olderSlots;

  const thinned: PricePoint[] = [];
  for (let i = 0; i < olderSlots; i++) {
    thinned.push(older[Math.floor(i * step)]);
  }

  return [...thinned, ...recent];
}

const styles = StyleSheet.create({
  plot: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    padding: spacing.sm,
  },
  axis: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.sm,
    justifyContent: "space-between",
  },
  axisLabel: { color: colors.textTertiary, fontSize: type.caption.fontSize },
  columns: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
  },
  columnSlot: { flex: 1, height: "100%", justifyContent: "flex-end" },
  column: { width: "100%", borderRadius: 2, minHeight: 3 },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  footerDate: { color: colors.textTertiary, fontSize: type.caption.fontSize },
  legend: { flexDirection: "row", gap: spacing.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  legendDot: { width: 8, height: 8, borderRadius: radius.pill },
  legendText: {
    color: colors.textSecondary,
    fontSize: type.caption.fontSize,
    fontWeight: "600",
  },
  empty: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.xs,
  },
  emptyTitle: {
    color: colors.textSecondary,
    fontSize: type.body.fontSize,
    fontWeight: "700",
  },
  emptyBody: {
    color: colors.textTertiary,
    fontSize: type.label.fontSize,
    textAlign: "center",
    lineHeight: 17,
  },
});
