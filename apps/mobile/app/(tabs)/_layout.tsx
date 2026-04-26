import React from 'react';
import { Tabs } from 'expo-router';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Colors, Fonts, Spacing, BorderRadius } from '../../constants/Colors';

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    index: '🏠',
    feed: '📊',
    leaderboard: '🏆',
    swarm: '🕸️',
    profile: '👤',
  };

  return (
    <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
      <Text style={styles.icon}>{icons[name] || '📋'}</Text>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => <TabIcon name="index" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          tabBarIcon: ({ focused }) => <TabIcon name="feed" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{
          title: 'Ranks',
          tabBarIcon: ({ focused }) => <TabIcon name="leaderboard" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="swarm"
        options={{
          title: 'Swarm',
          tabBarIcon: ({ focused }) => <TabIcon name="swarm" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <TabIcon name="profile" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.surface,
    borderTopColor: Colors.border,
    borderTopWidth: 1,
    height: Platform.OS === 'ios' ? 88 : 68,
    paddingTop: Spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? 24 : Spacing.sm,
    elevation: 0,
  },
  tabLabel: {
    fontFamily: Fonts.body,
    fontSize: 11,
    fontWeight: '600',
  },
  tabItem: {
    gap: 2,
  },
  iconContainer: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: BorderRadius.sm,
  },
  iconContainerActive: {
    backgroundColor: Colors.accent + '22',
  },
  icon: {
    fontSize: 18,
  },
});
