import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, DimensionValue } from 'react-native';
import { Colors, BorderRadius, Spacing } from '../../constants/Colors';

interface SkeletonLoaderProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: any;
  shimmer?: boolean;
}

export function SkeletonLoader({
  width = '100%',
  height = 16,
  borderRadius = BorderRadius.sm,
  style,
  shimmer = true,
}: SkeletonLoaderProps) {
  const opacity = useRef(new Animated.Value(0.3)).current;
  const translateX = useRef(new Animated.Value(-200)).current;

  const numericWidth = typeof width === 'number' ? width : 200;

  useEffect(() => {
    const animations: Animated.CompositeAnimation[] = [];

    // Base pulse animation
    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulseAnim.start();
    animations.push(pulseAnim);

    // Shimmer sweep animation
    if (shimmer) {
      const shimmerAnim = Animated.loop(
        Animated.timing(translateX, {
          toValue: numericWidth * 2,
          duration: 1500,
          useNativeDriver: true,
        })
      );
      shimmerAnim.start();
      animations.push(shimmerAnim);
    }

    return () => {
      animations.forEach((a) => a.stop());
    };
  }, [opacity, translateX, numericWidth, shimmer]);

  return (
    <Animated.View
      style={[
        {
          width: width as DimensionValue,
          height,
          borderRadius,
          backgroundColor: Colors.border,
          opacity,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {shimmer && (
        <Animated.View
          style={{
            width: '40%',
            height: '100%',
            backgroundColor: 'rgba(255,255,255,0.06)',
            transform: [{ translateX: translateX }],
          }}
        />
      )}
    </Animated.View>
  );
}

export function SkeletonCard() {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <SkeletonLoader width={48} height={48} borderRadius={BorderRadius.md} />
        <View style={styles.textCol}>
          <SkeletonLoader width={120} height={16} />
          <SkeletonLoader width={60} height={12} />
        </View>
      </View>
      <SkeletonLoader height={12} />
      <SkeletonLoader width="70%" height={12} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  textCol: {
    gap: Spacing.sm,
  },
});
