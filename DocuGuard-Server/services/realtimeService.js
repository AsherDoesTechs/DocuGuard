const { createClient } = require("@supabase/supabase-js");
const { debug, info, warn, error: logError } = require("../utils/debugLogger");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn("Supabase Realtime: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const channels = new Map();
const subscribers = new Map();

function generateChannelKey(userId, table) {
  return `${userId}:${table}`;
}

function getUserSubscribers(userId) {
  return subscribers.get(userId) || new Set();
}

function addSubscriber(userId, ws) {
  if (!subscribers.has(userId)) {
    subscribers.set(userId, new Set());
  }
  subscribers.get(userId).add(ws);
}

function attachWebSocketServer(server, jwtSecret) {
  const { WebSocketServer } = require("ws");
  const jwt = require("jsonwebtoken");
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, request) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const token = url.searchParams.get("token");
      const decoded = jwt.verify(token || "", jwtSecret);
      const userId = decoded.userId;
      addSubscriber(userId, ws);
      ws.send(JSON.stringify({
        type: "connected",
        timestamp: new Date().toISOString(),
      }));
      ws.on("close", () => removeSubscriber(userId, ws));
      ws.on("error", () => removeSubscriber(userId, ws));
    } catch (error) {
      ws.close(1008, "Invalid authentication token");
    }
  });

  return wss;
}

function removeSubscriber(userId, ws) {
  const userSubs = subscribers.get(userId);
  if (userSubs) {
    userSubs.delete(ws);
    if (userSubs.size === 0) {
      subscribers.delete(userId);
    }
  }
}

async function subscribeToUserChanges(userId) {
  const channelKey = generateChannelKey(userId, "documents");

  if (channels.has(channelKey)) {
    debug("Realtime", "Already subscribed to user documents", { userId });
    return channels.get(channelKey);
  }

  const documentsChannel = supabase
    .channel(`documents:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "documents",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        broadcastToUser(userId, "documents", payload);
      }
    )
    .subscribe((status) => {
      info("Realtime", "Documents channel status", { userId, status });
    });

  const remindersChannel = supabase
    .channel(`reminders:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "reminders",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        broadcastToUser(userId, "reminders", payload);
      }
    )
    .subscribe((status) => {
      info("Realtime", "Reminders channel status", { userId, status });
    });

  const profilesChannel = supabase
    .channel(`profiles:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "profiles",
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        broadcastToUser(userId, "profiles", payload);
      },
    )
    .subscribe((status) => {
      info("Realtime", "Profiles channel status", { userId, status });
    });

  channels.set(channelKey, { documentsChannel, remindersChannel, profilesChannel });

  info("Realtime", "Subscribed to user changes", { userId });

  return { documentsChannel, remindersChannel, profilesChannel };
}

function broadcastToUser(userId, table, payload) {
  const userSubs = getUserSubscribers(userId);
  if (userSubs.size === 0) {
    return;
  }

  const message = JSON.stringify({
    type: "realtime",
    table,
    event: payload.eventType,
    data: payload.new || payload.old,
    timestamp: new Date().toISOString(),
  });

  for (const ws of userSubs) {
    if (ws.readyState === 1) {
      try {
        ws.send(message);
      } catch (err) {
        warn("Realtime", "Failed to send to subscriber", { userId, error: err.message });
      }
    }
  }
}

async function unsubscribeFromUserChanges(userId) {
  const channelKey = generateChannelKey(userId, "documents");
  const userChannels = channels.get(channelKey);

  if (userChannels) {
    await supabase.removeChannel(userChannels.documentsChannel);
    await supabase.removeChannel(userChannels.remindersChannel);
    await supabase.removeChannel(userChannels.profilesChannel);
    channels.delete(channelKey);
    info("Realtime", "Unsubscribed from user changes", { userId });
  }
}

async function subscribeAllUsers() {
  const db = require("../config/db");
  try {
    const { rows } = await db.query("SELECT id FROM users WHERE is_verified = TRUE");
    for (const user of rows) {
      await subscribeToUserChanges(user.id);
    }
    info("Realtime", "Subscribed to all verified users", { count: rows.length });
  } catch (err) {
    logError("Realtime", "Failed to subscribe all users", { error: err.message });
  }
}

module.exports = {
  subscribeToUserChanges,
  unsubscribeFromUserChanges,
  subscribeAllUsers,
  addSubscriber,
  removeSubscriber,
  broadcastToUser,
  getUserSubscribers,
  attachWebSocketServer,
};