import React, { useEffect } from 'react'
import { ActivityIndicator, View, Text } from 'react-native'
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { Colors } from '../constants/colors'
import { useTheme } from '../contexts/ThemeContext'
import { useAuthStore } from '../store/authStore'
import { useMessagingStore } from '../store/messagingStore'

// Auth screens
import LoginScreen from '../screens/LoginScreen'

// Main screens
import DashboardScreen from '../screens/DashboardScreen'
import CoreChatScreen from '../screens/CoreChatScreen'
import NewThoughtScreen from '../screens/NewThoughtScreen'
import MyCircleScreen from '../screens/MyCircleScreen'
import MoreScreen from '../screens/MoreScreen'

// More stack screens
import PersonasScreen from '../screens/PersonasScreen'
import KnowledgeWorkerScreen from '../screens/KnowledgeWorkerScreen'
import PersonaChatScreen from '../screens/PersonaChatScreen'
import MessagesScreen from '../screens/MessagesScreen'
import ConnectionsScreen from '../screens/ConnectionsScreen'
import PlannerScreen from '../screens/PlannerScreen'
import ActionsScreen from '../screens/ActionsScreen'
import InsightsScreen from '../screens/InsightsScreen'
import ReflectionsScreen from '../screens/ReflectionsScreen'
import MyContextScreen from '../screens/MyContextScreen'
import MemoryScreen from '../screens/MemoryScreen'
import EditProfileScreen from '../screens/EditProfileScreen'
import PrivacyDataScreen from '../screens/PrivacyDataScreen'
import ThoughtDetailScreen from '../screens/ThoughtDetailScreen'
import PersonDetailScreen from '../screens/PersonDetailScreen'
import ContactsPickerScreen from '../screens/ContactsPickerScreen'
import LifeDimensionsScreen from '../screens/LifeDimensionsScreen'
import WeeklyCheckinScreen from '../screens/WeeklyCheckinScreen'

// --- Navigators ---
const AuthStack = createNativeStackNavigator()
const DashboardStack = createNativeStackNavigator()
const NewThoughtStack = createNativeStackNavigator()
const CircleStack = createNativeStackNavigator()
const MoreStack = createNativeStackNavigator()
const Tab = createBottomTabNavigator()

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
    </AuthStack.Navigator>
  )
}

function DashboardStackScreen() {
  const { colors } = useTheme()
  return (
    <DashboardStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        headerShadowVisible: false,
      }}
    >
      <DashboardStack.Screen name="DashboardHome" component={DashboardScreen} options={{ headerShown: false }} />
      <DashboardStack.Screen name="ThoughtDetail" component={ThoughtDetailScreen} options={{ title: 'Thought' }} />
      <DashboardStack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: 'Edit Profile' }} />
      <DashboardStack.Screen name="Planner" component={PlannerScreen} options={{ title: 'Day Planner' }} />
      <DashboardStack.Screen name="Actions" component={ActionsScreen} options={{ title: 'Action Items' }} />
      <DashboardStack.Screen name="Reflections" component={ReflectionsScreen} options={{ title: 'Reflections' }} />
      <DashboardStack.Screen name="PersonDetail" component={PersonDetailScreen} options={{ title: 'Person' }} />
      <DashboardStack.Screen name="PersonaChat" component={PersonaChatScreen} options={({ route }: any) => ({ title: route.params?.personaName || 'Chat' })} />
      <DashboardStack.Screen name="LifeDimensions" component={LifeDimensionsScreen} options={{ title: 'Life Wheel' }} />
      <DashboardStack.Screen name="WeeklyCheckin" component={WeeklyCheckinScreen} options={{ title: 'Weekly Check-in' }} />
    </DashboardStack.Navigator>
  )
}

function NewThoughtStackScreen() {
  const { colors } = useTheme()
  return (
    <NewThoughtStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        headerShadowVisible: false,
      }}
    >
      <NewThoughtStack.Screen name="NewThoughtHome" component={NewThoughtScreen} options={{ headerShown: false }} />
      <NewThoughtStack.Screen name="ThoughtDetail" component={ThoughtDetailScreen} options={{ title: 'Thought' }} />
    </NewThoughtStack.Navigator>
  )
}

function CircleStackScreen() {
  const { colors } = useTheme()
  return (
    <CircleStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        headerShadowVisible: false,
      }}
    >
      <CircleStack.Screen name="CircleHome" component={MyCircleScreen} options={{ headerShown: false, title: 'Circle' }} />
      <CircleStack.Screen name="PersonDetail" component={PersonDetailScreen} options={{ title: 'Person' }} />
      <CircleStack.Screen name="PersonaChat" component={PersonaChatScreen} options={({ route }: any) => ({ title: route.params?.personaName || 'Chat' })} />
      <CircleStack.Screen name="Messages" component={MessagesScreen} options={{ title: 'Messages' }} />
      <CircleStack.Screen name="Connections" component={ConnectionsScreen} options={{ title: 'Connection Requests' }} />
      <CircleStack.Screen name="ContactsPicker" component={ContactsPickerScreen} options={{ title: 'Import Contacts' }} />
    </CircleStack.Navigator>
  )
}

function MoreStackScreen() {
  const { colors } = useTheme()
  return (
    <MoreStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        headerShadowVisible: false,
      }}
    >
      <MoreStack.Screen name="MoreMenu" component={MoreScreen} options={{ title: 'More' }} />
      <MoreStack.Screen name="Personas" component={PersonasScreen} options={{ title: 'My Personas' }} />
      <MoreStack.Screen name="PersonaChat" component={PersonaChatScreen} options={({ route }: any) => ({ title: route.params?.personaName || 'Chat' })} />
      <MoreStack.Screen name="Planner" component={PlannerScreen} options={{ title: 'Day Planner' }} />
      <MoreStack.Screen name="Actions" component={ActionsScreen} options={{ title: 'Action Items' }} />
      <MoreStack.Screen name="Insights" component={InsightsScreen} options={{ title: 'Insights' }} />
      <MoreStack.Screen name="Reflections" component={ReflectionsScreen} options={{ title: 'Reflections' }} />
      <MoreStack.Screen name="MyContext" component={MyContextScreen} options={{ title: 'My Context' }} />
      <MoreStack.Screen name="Memory" component={MemoryScreen} options={{ title: 'Memory System' }} />
      <MoreStack.Screen name="KnowledgeWorker" component={KnowledgeWorkerScreen} options={{ title: 'Knowledge Worker' }} />
      <MoreStack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: 'Edit Profile' }} />
      <MoreStack.Screen name="PrivacyData" component={PrivacyDataScreen} options={{ title: 'Privacy & Data' }} />
    </MoreStack.Navigator>
  )
}

function TabIcon({ emoji }: { emoji: string }) {
  return <Text style={{ fontSize: 20 }}>{emoji}</Text>
}

function CircleTabIcon() {
  const totalUnread = useMessagingStore((s) => s.totalUnread)
  const pendingCount = useMessagingStore((s) => s.pendingRequests.length)
  const badge = totalUnread + pendingCount
  return (
    <View>
      <Text style={{ fontSize: 20 }}>👥</Text>
      {badge > 0 && (
        <View style={{
          position: 'absolute', top: -4, right: -10,
          minWidth: 16, height: 16, borderRadius: 8,
          backgroundColor: '#ef4444',
          alignItems: 'center', justifyContent: 'center',
          paddingHorizontal: 4,
        }}>
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      )}
    </View>
  )
}

function MainTabs() {
  const { colors } = useTheme()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const loadUnreadCount = useMessagingStore((s) => s.loadUnreadCount)
  const loadPendingRequests = useMessagingStore((s) => s.loadPendingRequests)

  // Poll unread + pending every 30s so tab badge stays fresh
  useEffect(() => {
    if (!isAuthenticated) return
    loadUnreadCount()
    loadPendingRequests()
    const id = setInterval(() => {
      loadUnreadCount()
      loadPendingRequests()
    }, 30000)
    return () => clearInterval(id)
  }, [isAuthenticated, loadUnreadCount, loadPendingRequests])

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary[500],
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          paddingBottom: 15,
          height: 67,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen
        name="DashboardTab"
        component={DashboardStackScreen}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: () => <TabIcon emoji="🏠" />,
        }}
      />
      <Tab.Screen
        name="CoreChatTab"
        component={CoreChatScreen}
        options={{
          tabBarLabel: 'Chat',
          tabBarIcon: () => <TabIcon emoji="💬" />,
        }}
      />
      <Tab.Screen
        name="NewThoughtTab"
        component={NewThoughtStackScreen}
        options={{
          tabBarLabel: 'Thought',
          tabBarIcon: () => <TabIcon emoji="✨" />,
        }}
      />
      <Tab.Screen
        name="CircleTab"
        component={CircleStackScreen}
        options={{
          tabBarLabel: 'Circle',
          tabBarIcon: () => <CircleTabIcon />,
        }}
      />
      <Tab.Screen
        name="MoreTab"
        component={MoreStackScreen}
        options={{
          tabBarLabel: 'More',
          tabBarIcon: () => <TabIcon emoji="☰" />,
        }}
      />
    </Tab.Navigator>
  )
}

export default function AppNavigator() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isLoading = useAuthStore((s) => s.isLoading)
  const { colors, isDark } = useTheme()

  const navTheme = isDark ? {
    ...DarkTheme,
    colors: { ...DarkTheme.colors, background: colors.background, card: colors.card, text: colors.text, border: colors.border, primary: colors.primary[500] },
  } : {
    ...DefaultTheme,
    colors: { ...DefaultTheme.colors, background: colors.background, card: colors.card, text: colors.text, border: colors.border, primary: colors.primary[500] },
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary[500]} />
      </View>
    )
  }

  return (
    <NavigationContainer theme={navTheme}>
      {isAuthenticated ? <MainTabs /> : <AuthNavigator />}
    </NavigationContainer>
  )
}
