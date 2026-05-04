import { useState, useEffect, useRef, useCallback } from 'react';
import { wsClient, WSMessage } from '../lib/ws';

interface FeedEvent {
  event_id: string;
  timestamp: string;
  agent_id: string;
  agent_display_name: string;
  category: string;
  severity: string;
  content: any;
  display_message: string;
  is_public: boolean;
}

interface ReactionUpdate {
  eventId: string;
  counts: Record<string, number>;
  userReactions: Array<{ userWallet: string; reactionType: string }>;
}

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

interface UseLiveFeedOptions {
  channel?: string;
  fallbackPollFn?: () => Promise<{ events: FeedEvent[] }>;
  fallbackPollInterval?: number;
}

export function useLiveFeed(options: UseLiveFeedOptions = {}) {
  const {
    channel = 'feed',
    fallbackPollFn,
    fallbackPollInterval = 10_000,
  } = options;

  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [newCount, setNewCount] = useState(0);
  const [viewerCount, setViewerCount] = useState(0);
  const [reactionUpdates, setReactionUpdates] = useState<Record<string, ReactionUpdate>>({});
  const prevChannelRef = useRef(channel);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAtBottomRef = useRef(true);

  const addEvent = useCallback((event: FeedEvent) => {
    setEvents((prev) => {
      // Deduplicate by event_id
      if (prev.some((e) => e.event_id === event.event_id)) return prev;
      const next = [event, ...prev];
      // Keep max 200 events
      return next.slice(0, 200);
    });
  }, []);

  const resetNewCount = useCallback(() => {
    setNewCount(0);
  }, []);

  // Handle WS messages
  useEffect(() => {
    wsClient.connect();

    const unsubscribe = wsClient.addListener((message: WSMessage) => {
      if (message.type === 'connected') {
        setStatus('connected');
      } else if (message.type === 'feed_event') {
        addEvent(message.data as FeedEvent);
        if (!isAtBottomRef.current) {
          setNewCount((c) => c + 1);
        }
      } else if (message.type === 'viewer_count') {
        const counts = message.data as Record<string, number>;
        setViewerCount(counts[channel] ?? counts['feed'] ?? 0);
      } else if (message.type === 'reaction_update') {
        const update = message.data as ReactionUpdate;
        setReactionUpdates((prev) => ({
          ...prev,
          [update.eventId]: update,
        }));
      }
    });

    // Set connected status if already connected
    if (wsClient.isConnected()) {
      setStatus('connected');
    }

    return () => {
      unsubscribe();
    };
  }, [addEvent, channel]);

  // Handle channel subscription changes
  useEffect(() => {
    if (prevChannelRef.current !== channel) {
      wsClient.unsubscribe(prevChannelRef.current);
      prevChannelRef.current = channel;
    }

    wsClient.subscribe(channel);
    setEvents([]);
    setNewCount(0);
    setReactionUpdates({});

    return () => {
      wsClient.unsubscribe(channel);
    };
  }, [channel]);

  // Fallback polling if WS is disconnected
  useEffect(() => {
    if (!fallbackPollFn) return;

    const poll = async () => {
      if (!wsClient.isConnected()) {
        try {
          const result = await fallbackPollFn();
          if (result?.events) {
            setEvents((prev) => {
              const existingIds = new Set(prev.map((e) => e.event_id));
              const newEvents = result.events.filter((e) => !existingIds.has(e.event_id));
              if (newEvents.length > 0) {
                return [...newEvents, ...prev].slice(0, 200);
              }
              return prev;
            });
          }
        } catch {
          // ignore poll errors
        }
      }
      pollTimerRef.current = setTimeout(poll, fallbackPollInterval);
    };

    pollTimerRef.current = setTimeout(poll, fallbackPollInterval);

    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, [fallbackPollFn, fallbackPollInterval]);

  return {
    events,
    status,
    newCount,
    viewerCount,
    reactionUpdates,
    resetNewCount,
    setAtBottom: (atBottom: boolean) => {
      isAtBottomRef.current = atBottom;
      if (atBottom) setNewCount(0);
    },
  };
}
