import React, { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { lerpColor } from '@/lib/color';

interface Props {
  from: string;
  to: string;
  /** 'diagonal' = CSS 135deg (top-left to bottom-right), 'horizontal' = 90deg */
  direction?: 'diagonal' | 'horizontal';
  steps?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * Gradient built from coloured bands (no expo-linear-gradient: it is not in the approved stack).
 * Diagonal = a horizontal band strip rotated 45 degrees inside an overflow-hidden box.
 */
export function Gradient({ from, to, direction = 'diagonal', steps = 14, style, children }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - size.w) > 0.5 || Math.abs(height - size.h) > 0.5) setSize({ w: width, h: height });
  };
  const bands = Array.from({ length: steps }, (_, i) => (
    <View key={i} style={{ flex: 1, backgroundColor: lerpColor(from, to, i / (steps - 1)) }} />
  ));

  let layer: React.ReactNode = null;
  if (size.w > 0) {
    if (direction === 'horizontal') {
      layer = <View style={[StyleSheet.absoluteFill, styles.row]}>{bands}</View>;
    } else {
      const diag = Math.sqrt(size.w * size.w + size.h * size.h);
      layer = (
        <View
          style={[
            styles.row,
            {
              position: 'absolute',
              width: diag,
              height: diag,
              left: (size.w - diag) / 2,
              top: (size.h - diag) / 2,
              transform: [{ rotate: '45deg' }],
            },
          ]}
        >
          {bands}
        </View>
      );
    }
  }

  return (
    <View onLayout={onLayout} style={[{ overflow: 'hidden', backgroundColor: from }, style]}>
      {layer}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row' } });
