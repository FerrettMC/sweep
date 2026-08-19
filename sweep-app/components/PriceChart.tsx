// components/PriceChart.tsx
//
// Price history as a continuous line, drawn with plain Views.
//
// Deliberately no charting library: every RN chart lib pulls in
// react-native-svg, which is a native module, and this project ships a
// prebuilt android/ folder — adding one would force a full rebuild. Each
// segment of the line is a thin rectangle rotated to point at the next
// reading, which needs nothing but View and a transform.
//
// This replaced a column chart. Columns read as discrete events — "it cost
// this much on Tuesday" — when a price is really a value that holds between
// observations. A line is the closer description of what actually happened,
// and it's what price history looks like everywhere people already read it.
//
// The geometry lives in lib/chartGeometry.ts, tested, because a chart that is
// subtly wrong still looks exactly like a chart.

import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { type Palette, radius, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";
import { formatChartDate, formatPrice, formatPriceShort } from "@/lib/format";
import { type ChartPoint, buildLine, downsample } from "@/lib/chartGeometry";

export type PricePoint = ChartPoint;

interface Props {
  history: PricePoint[];
  currentPrice: number | null;
  height?: number;
  /** Ceiling on rendered points. Older readings are thinned to fit. */
  maxPoints?: number;
}

/** Thin enough to read as a line, thick enough to see on a phone. */
const STROKE = 2;
const DOT = 7;

export default function PriceChart({
  history,
  currentPrice,
  height = 160,
  maxPoints = 60,
}: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();

  // Measured rather than assumed: the card this sits in is a different width
  // on every screen, and the line has to be positioned in real pixels.
  const [width, setWidth] = useState(0);

  const points = useMemo(() => downsample(history, maxPoints), [history, maxPoints]);
  const plotHeight = height - spacing.sm * 2;
  const layout = useMemo(
    () => buildLine(points, width, plotHeight, STROKE),
    [points, width, plotHeight],
  );

  if (history.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyTitle}>{t("priceChart.empty")}</Text>
        <Text style={styles.emptyBody}>{t("priceChart.emptyBody")}</Text>
      </View>
    );
  }

  return (
    <View>
      <View
        style={[styles.plot, { height }]}
        onLayout={(event) =>
          // Minus the padding, so the line spans the drawable area rather than
          // running under the border.
          setWidth(event.nativeEvent.layout.width - spacing.sm * 2)
        }
      >
        {/* Behind the line, so labels never shift the layout. */}
        <View style={styles.axis} pointerEvents="none">
          <Text style={styles.axisLabel}>
            {formatPriceShort(layout?.high ?? null)}
          </Text>
          <Text style={styles.axisLabel}>
            {formatPriceShort(layout?.low ?? null)}
          </Text>
        </View>

        {/* Rendered only once the width is known. Drawing at zero width first
            would flash a collapsed line on every mount. */}
        {layout && (
          <View style={styles.canvas}>
            {layout.segments.map((segment, index) => (
              <View
                key={index}
                style={[
                  styles.segment,
                  {
                    left: segment.left,
                    top: segment.top,
                    width: segment.width,
                    transform: [{ rotate: `${segment.angle}deg` }],
                  },
                ]}
              />
            ))}

            {layout.dots.map((dot) => (
              <View
                key={dot.kind}
                style={[
                  styles.dot,
                  {
                    left: dot.x - DOT / 2,
                    top: dot.y - DOT / 2,
                    backgroundColor:
                      dot.kind === "low" ? colors.success : colors.accent,
                  },
                ]}
              />
            ))}
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerDate}>
          {layout ? formatChartDate(layout.first) : ""}
        </Text>
        <View style={styles.legend}>
          {/* Only shown when there IS a low distinct from everything else —
              labelling a flat line's "low" implies a fall that never happened. */}
          {layout && layout.high > layout.low && (
            <Legend color={colors.success} label={`Low ${formatPrice(layout.low)}`} />
          )}
          <Legend
            color={colors.accent}
            label={`Now ${formatPrice(currentPrice ?? layout?.high ?? null)}`}
          />
        </View>
        <Text style={styles.footerDate}>
          {layout ? formatChartDate(layout.last) : ""}
        </Text>
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
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
    canvas: { flex: 1 },
    segment: {
      position: "absolute",
      height: STROKE,
      backgroundColor: colors.accent,
      borderRadius: STROKE / 2,
    },
    dot: {
      position: "absolute",
      width: DOT,
      height: DOT,
      borderRadius: DOT / 2,
      borderWidth: 1.5,
      borderColor: colors.surface,
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: spacing.xs,
      gap: spacing.xs,
    },
    footerDate: { color: colors.textTertiary, fontSize: type.caption.fontSize },
    legend: { flexDirection: "row", gap: spacing.sm },
    legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
    legendDot: { width: 7, height: 7, borderRadius: 3.5 },
    legendText: { color: colors.textSecondary, fontSize: type.caption.fontSize },
    empty: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      padding: spacing.md,
    },
    emptyTitle: {
      color: colors.textSecondary,
      fontSize: type.label.fontSize,
      fontWeight: "700",
    },
    emptyBody: {
      color: colors.textTertiary,
      fontSize: type.caption.fontSize,
      textAlign: "center",
    },
  });
