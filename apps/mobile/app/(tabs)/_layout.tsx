import React from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Fonts, Spacing, BorderRadius } from '../../constants/Colors';

const TAB_ICONS: Record<string, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  index: { active: 'home', inactive: 'home-outline' },
  feed: { active: 'newspaper', inactive: 'newspaper-outline' },
  leaderboard: { active: 'trophy', inactive: 'trophy-outline' },
  swarm: { active: 'git-network', inactive: 'git-network-outline' },
  profile: { active: 'person', inactive: 'person-outline' },
};

function TabIcon({ name, focused, color }: { name: string; focused: boolean; color: string }) {
  const icons = TAB_ICONS[name] ?? { active: 'apps', inactive: 'apps-outline' };
  const iconName = focused ? icons.active : icons.inactive;

  return (
    <View style={[styles.iconContainer, focused && styles.iconContainerActive]}>
      <Ionicons name={iconName} size={22} color={color} />
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
        tabBarIcon: ({ focused, color }) => null, // handled per-screen
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused, color }) => <TabIcon name="index" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          tabBarIcon: ({ focused, color }) => <TabIcon name="feed" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{
          title: 'Ranks',
          tabBarIcon: ({ focused, color }) => <TabIcon name="leaderboard" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="swarm"
        options={{
          title: 'Swarm',
          tabBarIcon: ({ focused, color }) => <TabIcon name="swarm" focused={focused} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused, color }) => <TabIcon name="profile" focused={focused} color={color} />,
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
});
