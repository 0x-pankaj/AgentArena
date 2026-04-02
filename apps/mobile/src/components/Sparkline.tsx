import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Colors } from '../../constants/Colors';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export function Sparkline({ data, width = 50, height = 20, color }: SparklineProps) {
  if (!data || data.length === 0) return null;

  const max = Math.max(...data.map(Math.abs), 1);
  const barWidth = Math.max(2, (width - (data.length - 1) * 2) / data.length);

  return (
    <View style={[styles.container, { width, height }]}>
      {data.map((value, index) => {
        const normalizedHeight = Math.max(2, (Math.abs(value) / max) * height);
        const barColor = color ?? (value >= 0 ? Colors.success : Colors.danger);

        return (
          <View
            key={index}
            style={[
              styles.bar,
              {
                width: barWidth,
                height: normalizedHeight,
                backgroundColor: barColor,
                opacity: 0.4 + (index / data.length) * 0.6,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  bar: {
    borderRadius: 1,
  },
});
